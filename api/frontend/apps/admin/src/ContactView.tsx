import { useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import { extractErrorMessage } from '@shared/api';
import { formatDateTime } from '@shared/format';
import type { ContactSettingsSummary } from '@shared/types';

import { adminRequest, deleteAdminPhoto, isUnauthorizedError, uploadAdminPhoto } from './admin-api';
import { DetailItem, LoadingPanel } from './admin-ui';

function emptyContactState(): ContactSettingsSummary {
  return {
    welcome_message: '',
    welcome_photo_url: '',
    telegram_id: null,
    telegram_username: '',
    phone_number: '',
    email_address: '',
    additional_info: '',
    last_updated: null,
    updated_by: null,
  };
}

function readString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value && typeof value === 'object') {
    const namedValue = (value as { name?: unknown }).name;
    if (typeof namedValue === 'string') {
      return namedValue;
    }
  }

  return fallback;
}

function readNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeContactSettings(input: unknown): ContactSettingsSummary {
  const payload = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  return {
    welcome_message: readString(payload.welcome_message),
    welcome_photo_url: readString(payload.welcome_photo_url),
    telegram_id: readNullableNumber(payload.telegram_id),
    telegram_username: readString(payload.telegram_username),
    phone_number: readString(payload.phone_number),
    email_address: readString(payload.email_address),
    additional_info: readString(payload.additional_info),
    last_updated: readString(payload.last_updated) || null,
    updated_by: readNullableNumber(payload.updated_by),
  };
}

export default function ContactView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [contact, setContact] = useState<ContactSettingsSummary>(emptyContactState);
  const [welcomePhotoFile, setWelcomePhotoFile] = useState<File | null>(null);
  const [welcomePhotoPreviewUrl, setWelcomePhotoPreviewUrl] = useState('');
  const [savedWelcomePhotoUrl, setSavedWelcomePhotoUrl] = useState<string | null>(null);
  const [welcomePhotoRemoved, setWelcomePhotoRemoved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingWelcome, setSavingWelcome] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!welcomePhotoPreviewUrl.startsWith('blob:')) {
      return undefined;
    }

    return () => {
      URL.revokeObjectURL(welcomePhotoPreviewUrl);
    };
  }, [welcomePhotoPreviewUrl]);

  async function loadContact() {
    setLoading(true);
    try {
      const response = await adminRequest<ContactSettingsSummary>(token, '/contact');
      const normalizedResponse = normalizeContactSettings(response);
      setContact({
        ...emptyContactState(),
        ...normalizedResponse,
      });
      setSavedWelcomePhotoUrl(normalizedResponse.welcome_photo_url || null);
      setWelcomePhotoPreviewUrl(normalizedResponse.welcome_photo_url || '');
      setWelcomePhotoFile(null);
      setWelcomePhotoRemoved(false);
      setError('');
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadContact();
  }, [token]);

  function handlePhotoSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Welcome photo must be an image.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Welcome photo must be smaller than 5MB.');
      return;
    }

    setWelcomePhotoFile(file);
    setWelcomePhotoPreviewUrl(URL.createObjectURL(file));
    setWelcomePhotoRemoved(false);
    setError('');
  }

  function removeWelcomePhoto() {
    setWelcomePhotoFile(null);
    setWelcomePhotoPreviewUrl('');
    if (savedWelcomePhotoUrl) {
      setWelcomePhotoRemoved(true);
    }
  }

  async function saveWelcome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!contact.welcome_message.trim()) {
      setError('Welcome message cannot be empty.');
      return;
    }

    setSavingWelcome(true);
    try {
      let nextPhotoUrl = welcomePhotoRemoved ? null : savedWelcomePhotoUrl;

      if (welcomePhotoFile) {
        const uploadResponse = await uploadAdminPhoto(token, welcomePhotoFile, savedWelcomePhotoUrl);
        nextPhotoUrl = uploadResponse.photo_url;
      } else if (welcomePhotoRemoved && savedWelcomePhotoUrl) {
        await deleteAdminPhoto(token, savedWelcomePhotoUrl);
        nextPhotoUrl = null;
      }

      const response = await adminRequest<{
        message: string;
        welcome_message: string;
        welcome_photo_url?: string | null;
        updated_at: string;
      }>(token, '/contact/welcome-message', {
        method: 'POST',
        body: JSON.stringify({
          welcome_message: contact.welcome_message.trim(),
          welcome_photo_url: nextPhotoUrl || '',
        }),
      });

      setContact((current) => ({
        ...current,
        welcome_message: response.welcome_message,
        welcome_photo_url: response.welcome_photo_url || '',
        last_updated: response.updated_at || current.last_updated,
      }));
      setSavedWelcomePhotoUrl(response.welcome_photo_url || null);
      setWelcomePhotoPreviewUrl(response.welcome_photo_url || '');
      setWelcomePhotoFile(null);
      setWelcomePhotoRemoved(false);
      setError('');
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    } finally {
      setSavingWelcome(false);
    }
  }

  async function saveContactInfo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !contact.telegram_id &&
      !contact.telegram_username?.trim() &&
      !contact.phone_number?.trim() &&
      !contact.email_address?.trim()
    ) {
      setError('Provide at least one contact method.');
      return;
    }

    setSavingContact(true);
    try {
      const response = await adminRequest<{
        message: string;
        contact_info: ContactSettingsSummary;
        updated_at: string;
      }>(token, '/contact/info', {
        method: 'POST',
        body: JSON.stringify({
          telegram_id: contact.telegram_id || null,
          telegram_username: contact.telegram_username?.trim() || '',
          phone_number: contact.phone_number?.trim() || '',
          email_address: contact.email_address?.trim() || '',
          additional_info: contact.additional_info?.trim() || '',
        }),
      });
      const normalizedContactInfo = normalizeContactSettings(response.contact_info);

      setContact((current) => ({
        ...current,
        ...normalizedContactInfo,
        welcome_message: current.welcome_message,
        welcome_photo_url: current.welcome_photo_url,
        last_updated: response.updated_at || current.last_updated,
      }));
      setError('');
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    } finally {
      setSavingContact(false);
    }
  }

  if (loading) {
    return <LoadingPanel label="Loading contact settings" />;
  }

  const welcomePreview = contact.welcome_message.trim()
    ? contact.welcome_message.replaceAll('{{name}}', 'John').replaceAll('\n', '<br />')
    : '<em>Welcome message preview will appear here.</em>';

  const contactPreview = [
    contact.telegram_username ? `Telegram: @${contact.telegram_username.replace(/^@/, '')}` : null,
    contact.phone_number ? `Phone: ${contact.phone_number}` : null,
    contact.email_address ? `Email: ${contact.email_address}` : null,
    contact.additional_info || null,
  ]
    .filter(Boolean)
    .join(' • ');

  return (
    <section className="stack">
      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Contact</p>
            <h3>Welcome copy and support channels</h3>
          </div>
        </div>
        <dl className="detail-grid">
          <DetailItem label="Last Updated" value={formatDateTime(contact.last_updated)} />
          <DetailItem label="Telegram ID" value={contact.telegram_id ?? 'Not set'} />
        </dl>
      </article>

      {error ? <div className="panel inline-error">{error}</div> : null}

      <section className="two-column-layout">
        <article className="panel detail-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Welcome Message</p>
              <h3>First-touch customer messaging</h3>
            </div>
          </div>

          <form className="stack" onSubmit={saveWelcome}>
            <label className="field">
              <span>Message</span>
              <textarea
                rows={8}
                value={contact.welcome_message}
                onChange={(event) => setContact((current) => ({ ...current, welcome_message: event.target.value }))}
                placeholder="Welcome to our delivery service!"
              />
            </label>
            <p className="muted-copy">
              HTML formatting is supported. Use <code>{'{{name}}'}</code> to preview the customer&apos;s first name.
            </p>

            <div className="image-editor">
              <div className="image-preview-shell">
                {welcomePhotoPreviewUrl ? (
                  <img alt="Welcome preview" className="editor-image-preview" src={welcomePhotoPreviewUrl} />
                ) : (
                  <div className="image-placeholder">No welcome photo</div>
                )}
              </div>
              <div className="stack">
                <label className="field">
                  <span>Photo</span>
                  <input accept="image/*" onChange={handlePhotoSelection} type="file" />
                </label>
                {(welcomePhotoPreviewUrl || savedWelcomePhotoUrl) && (
                  <button className="ghost-button compact-button" onClick={removeWelcomePhoto} type="button">
                    Remove Photo
                  </button>
                )}
              </div>
            </div>

            <button className="primary-button" disabled={savingWelcome} type="submit">
              {savingWelcome ? 'Saving…' : 'Save Welcome Message'}
            </button>
          </form>

          <div className="preview-card">
            <p className="eyebrow">Preview</p>
            <div dangerouslySetInnerHTML={{ __html: welcomePreview }} />
          </div>
        </article>

        <article className="panel detail-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Contact Information</p>
              <h3>Customer support details</h3>
            </div>
          </div>

          <form className="stack" onSubmit={saveContactInfo}>
            <div className="split-fields">
              <label className="field">
                <span>Telegram ID</span>
                <input
                  type="number"
                  value={contact.telegram_id ?? ''}
                  onChange={(event) =>
                    setContact((current) => ({
                      ...current,
                      telegram_id: event.target.value ? Number(event.target.value) : null,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Telegram username</span>
                <input
                  value={contact.telegram_username || ''}
                  onChange={(event) => setContact((current) => ({ ...current, telegram_username: event.target.value }))}
                  placeholder="@username"
                />
              </label>
            </div>

            <div className="split-fields">
              <label className="field">
                <span>Phone number</span>
                <input
                  value={contact.phone_number || ''}
                  onChange={(event) => setContact((current) => ({ ...current, phone_number: event.target.value }))}
                  placeholder="+1 (555) 123-4567"
                />
              </label>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={contact.email_address || ''}
                  onChange={(event) => setContact((current) => ({ ...current, email_address: event.target.value }))}
                  placeholder="contact@yourstore.com"
                />
              </label>
            </div>

            <label className="field">
              <span>Additional info</span>
              <textarea
                rows={4}
                value={contact.additional_info || ''}
                onChange={(event) => setContact((current) => ({ ...current, additional_info: event.target.value }))}
                placeholder="Extra support or service notes"
              />
            </label>

            <button className="primary-button" disabled={savingContact} type="submit">
              {savingContact ? 'Saving…' : 'Save Contact Information'}
            </button>
          </form>

          <div className="preview-card">
            <p className="eyebrow">Customer-facing preview</p>
            <p>{contactPreview || 'Support contact preview will appear here once at least one channel is filled in.'}</p>
          </div>
        </article>
      </section>
    </section>
  );
}
