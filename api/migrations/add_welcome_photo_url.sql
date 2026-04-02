-- Migration: Add welcome_photo_url to contact_settings table
-- Date: 2026-01-15
-- Description: Add support for welcome message photos

-- Add welcome_photo_url column to contact_settings table
ALTER TABLE contact_settings 
ADD COLUMN IF NOT EXISTS welcome_photo_url VARCHAR(500);

-- Add comment to the column
COMMENT ON COLUMN contact_settings.welcome_photo_url IS 'URL to the welcome message photo';
