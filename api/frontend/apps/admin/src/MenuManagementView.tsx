import { useDeferredValue, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import { extractErrorMessage } from '@shared/api';
import { formatCurrency } from '@shared/format';
import type { AdminMenuItem } from '@shared/types';

import { adminRequest, deleteAdminPhoto, isUnauthorizedError, uploadAdminPhoto } from './admin-api';
import { EmptyPanel, StatusPill } from './admin-ui';

interface MenuFormState {
  category: string;
  name: string;
  description: string;
  price: string;
  stock: string;
  active: boolean;
}

interface EditorPhoto {
  id: string;
  url: string;
  file?: File;
  persisted: boolean;
}

function emptyMenuForm(): MenuFormState {
  return {
    category: '',
    name: '',
    description: '',
    price: '',
    stock: '0',
    active: true,
  };
}

function normalizeItemPhotoUrls(item: AdminMenuItem | null | undefined): string[] {
  const urls = [...(item?.photo_urls || [])];
  if (item?.photo_url && !urls.includes(item.photo_url)) {
    urls.unshift(item.photo_url);
  }
  return urls.filter(Boolean);
}

function toEditorPhotos(photoUrls: string[]): EditorPhoto[] {
  return photoUrls.map((url, index) => ({
    id: `persisted-${index}-${url}`,
    url,
    persisted: true,
  }));
}

export default function MenuManagementView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [items, setItems] = useState<AdminMenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [form, setForm] = useState<MenuFormState>(emptyMenuForm);
  const [photos, setPhotos] = useState<EditorPhoto[]>([]);
  const [removedSavedPhotoUrls, setRemovedSavedPhotoUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const deferredSearch = useDeferredValue(search);
  const photoRef = useRef<EditorPhoto[]>([]);

  useEffect(() => {
    photoRef.current = photos;
  }, [photos]);

  useEffect(() => {
    return () => {
      for (const photo of photoRef.current) {
        if (!photo.persisted && photo.url.startsWith('blob:')) {
          URL.revokeObjectURL(photo.url);
        }
      }
    };
  }, []);

  async function loadCatalog() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('active_only', String(statusFilter === 'active'));
      if (deferredSearch.trim()) {
        params.set('search', deferredSearch.trim());
      }

      const [itemsResponse, categoriesResponse] = await Promise.all([
        adminRequest<AdminMenuItem[]>(token, `/menu/items?${params.toString()}`),
        adminRequest<string[]>(token, '/menu/categories'),
      ]);

      const nextItems = Array.isArray(itemsResponse) ? itemsResponse : [];
      setItems(statusFilter === 'inactive' ? nextItems.filter((item) => !item.active) : nextItems);
      setCategories(Array.isArray(categoriesResponse) ? categoriesResponse : []);
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
    void loadCatalog();
  }, [token, statusFilter, deferredSearch]);

  function resetEditor() {
    for (const photo of photos) {
      if (!photo.persisted && photo.url.startsWith('blob:')) {
        URL.revokeObjectURL(photo.url);
      }
    }
    setSelectedItemId(null);
    setForm(emptyMenuForm());
    setPhotos([]);
    setRemovedSavedPhotoUrls([]);
  }

  function selectItem(item: AdminMenuItem) {
    for (const photo of photos) {
      if (!photo.persisted && photo.url.startsWith('blob:')) {
        URL.revokeObjectURL(photo.url);
      }
    }
    setSelectedItemId(item.id);
    setForm({
      category: item.category,
      name: item.name,
      description: item.description || '',
      price: ((item.price_cents || 0) / 100).toFixed(2),
      stock: String(item.stock ?? 0),
      active: item.active,
    });
    setPhotos(toEditorPhotos(normalizeItemPhotoUrls(item)));
    setRemovedSavedPhotoUrls([]);
  }

  function handlePhotoSelection(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files || []);
    if (!nextFiles.length) {
      return;
    }

    const nextPhotos: EditorPhoto[] = [];
    for (const file of nextFiles) {
      if (!file.type.startsWith('image/')) {
        setError('Each photo must be an image file.');
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        setError('Each photo must be smaller than 5MB.');
        return;
      }

      nextPhotos.push({
        id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        url: URL.createObjectURL(file),
        file,
        persisted: false,
      });
    }

    setPhotos((current) => [...current, ...nextPhotos]);
    setError('');
    event.target.value = '';
  }

  function removePhoto(photoId: string) {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === photoId);
      if (target?.persisted && target.url) {
        setRemovedSavedPhotoUrls((existing) => (existing.includes(target.url) ? existing : [...existing, target.url]));
      }
      if (target && !target.persisted && target.url.startsWith('blob:')) {
        URL.revokeObjectURL(target.url);
      }
      return current.filter((photo) => photo.id !== photoId);
    });
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedPrice = Number.parseFloat(form.price);
    const parsedStock = Number.parseInt(form.stock, 10);

    if (!form.category.trim() || !form.name.trim()) {
      setError('Category and item name are required.');
      return;
    }

    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      setError('Price must be a valid positive number.');
      return;
    }

    if (Number.isNaN(parsedStock) || parsedStock < 0) {
      setError('Stock must be zero or greater.');
      return;
    }

    setSaving(true);
    const uploadedPhotoUrls: string[] = [];
    try {
      const uploadedPhotoMap = new Map<string, string>();
      for (const photo of photos) {
        if (photo.persisted || !photo.file) {
          continue;
        }
        const uploadResponse = await uploadAdminPhoto(token, photo.file);
        uploadedPhotoMap.set(photo.id, uploadResponse.photo_url);
        uploadedPhotoUrls.push(uploadResponse.photo_url);
      }

      const finalPhotoUrls = photos.map((photo) => (
        photo.persisted ? photo.url : uploadedPhotoMap.get(photo.id) || ''
      )).filter(Boolean);

      const payload = {
        category: form.category.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        price_cents: Math.round(parsedPrice * 100),
        stock: parsedStock,
        active: form.active,
        photo_url: finalPhotoUrls[0] || null,
        photo_urls: finalPhotoUrls,
      };

      if (selectedItemId) {
        await adminRequest(token, `/menu/items/${selectedItemId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await adminRequest(token, '/menu/items', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      for (const removedUrl of removedSavedPhotoUrls) {
        await deleteAdminPhoto(token, removedUrl);
      }

      resetEditor();
      await loadCatalog();
    } catch (cause) {
      for (const uploadedUrl of uploadedPhotoUrls) {
        try {
          await deleteAdminPhoto(token, uploadedUrl);
        } catch {
          // Best-effort cleanup for failed saves.
        }
      }
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function setItemActive(item: AdminMenuItem, nextActive: boolean) {
    const message = nextActive
      ? `Restore menu item "${item.name}"?`
      : `Deactivate menu item "${item.name}"?`;
    if (!window.confirm(message)) {
      return;
    }

    try {
      if (nextActive) {
        await adminRequest(token, `/menu/items/${item.id}`, {
          method: 'PUT',
          body: JSON.stringify({ active: true }),
        });
      } else {
        await adminRequest(token, `/menu/items/${item.id}`, {
          method: 'DELETE',
        });
      }

      if (selectedItemId === item.id && !nextActive) {
        setForm((current) => ({ ...current, active: false }));
      }
      await loadCatalog();
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    }
  }

  async function permanentlyDeleteItem(item: AdminMenuItem) {
    if (!window.confirm(`Permanently delete "${item.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await adminRequest(token, `/menu/items/${item.id}/permanent-universal`, {
        method: 'DELETE',
      });
      if (selectedItemId === item.id) {
        resetEditor();
      }
      await loadCatalog();
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    }
  }

  return (
    <section className="two-column-layout">
      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Menu</p>
            <h3>Catalog and photos</h3>
          </div>
          <div className="inline-actions">
            <button className="secondary-button" onClick={() => void loadCatalog()} type="button">
              Refresh
            </button>
            <button className="secondary-button" onClick={resetEditor} type="button">
              New Item
            </button>
          </div>
        </div>

        <div className="toolbar">
          <input
            className="search-input"
            placeholder="Search name, category, or description"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="all">All items</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </div>

        {error ? <div className="inline-error">{error}</div> : null}

        {loading ? (
          <div className="empty-panel compact-empty">Loading menu items…</div>
        ) : items.length ? (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>Category</th>
                  <th>Name</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const itemPhotoUrls = normalizeItemPhotoUrls(item);
                  return (
                    <tr
                      key={item.id}
                      className={selectedItemId === item.id ? 'selected-row' : ''}
                      onClick={() => selectItem(item)}
                    >
                      <td>
                        {item.photo_url ? (
                          <div className="table-thumb-stack">
                            <img alt={item.name} className="table-thumb" src={item.photo_url} />
                            <span className="gallery-count-pill">{itemPhotoUrls.length}</span>
                          </div>
                        ) : (
                          <div className="thumb-placeholder">No photo</div>
                        )}
                      </td>
                      <td>{item.category || 'Uncategorized'}</td>
                      <td>
                        <strong>{item.name}</strong>
                        {item.description ? <p className="table-subcopy">{item.description}</p> : null}
                      </td>
                      <td>{formatCurrency(item.price_cents)}</td>
                      <td>{item.stock}</td>
                      <td>
                        <StatusPill tone={item.active ? 'approved' : 'cancelled'}>
                          {item.active ? 'Active' : 'Inactive'}
                        </StatusPill>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="secondary-button compact-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectItem(item);
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="ghost-button compact-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void setItemActive(item, !item.active);
                            }}
                            type="button"
                          >
                            {item.active ? 'Deactivate' : 'Restore'}
                          </button>
                          {!item.active ? (
                            <button
                              className="ghost-button compact-button danger-text"
                              onClick={(event) => {
                                event.stopPropagation();
                                void permanentlyDeleteItem(item);
                              }}
                              type="button"
                            >
                              Delete Permanently
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel title="No menu items" copy="Create a menu item to publish it to the Telegram bot and Mini App." />
        )}
      </article>

      <article className="panel detail-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{selectedItemId ? 'Edit Item' : 'Create Item'}</p>
            <h3>{selectedItemId ? 'Update catalog entry' : 'Add a new menu item'}</h3>
          </div>
          {selectedItemId ? (
            <StatusPill tone={form.active ? 'approved' : 'cancelled'}>
              {form.active ? 'Active' : 'Inactive'}
            </StatusPill>
          ) : null}
        </div>

        <form className="stack" onSubmit={saveItem}>
          <label className="field">
            <span>Category</span>
            <input
              list="menuCategories"
              value={form.category}
              onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
              placeholder="Pizza"
            />
            <datalist id="menuCategories">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Name</span>
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Pepperoni Pizza"
            />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              rows={4}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Describe the item"
            />
          </label>
          <div className="split-fields">
            <label className="field">
              <span>Price (USD)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Stock</span>
              <input
                type="number"
                min="0"
                step="1"
                value={form.stock}
                onChange={(event) => setForm((current) => ({ ...current, stock: event.target.value }))}
              />
            </label>
          </div>
          <label className="checkbox-row">
            <input
              checked={form.active}
              onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
              type="checkbox"
            />
            <span>Visible for ordering</span>
          </label>

          <div className="image-editor image-editor-gallery">
            <div className="stack">
              <label className="field">
                <span>Photos</span>
                <input accept="image/*" multiple onChange={handlePhotoSelection} type="file" />
              </label>
              <p className="muted-copy">Upload multiple product photos. The first photo becomes the primary menu thumbnail.</p>
            </div>
            <div className="gallery-editor-grid">
              {photos.length ? (
                photos.map((photo, index) => (
                  <article key={photo.id} className="gallery-editor-card">
                    <div className="image-preview-shell">
                      <img
                        alt={`Menu item photo ${index + 1}`}
                        className="editor-image-preview"
                        src={photo.url}
                      />
                    </div>
                    <div className="gallery-editor-meta">
                      <span className="gallery-count-pill">{index === 0 ? 'Primary' : `Photo ${index + 1}`}</span>
                      <button className="ghost-button compact-button" onClick={() => removePhoto(photo.id)} type="button">
                        Remove
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="image-placeholder">No photos uploaded</div>
              )}
            </div>
          </div>

          <div className="inline-actions">
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Saving…' : selectedItemId ? 'Update Item' : 'Create Item'}
            </button>
            <button className="secondary-button" onClick={resetEditor} type="button">
              Reset
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}
