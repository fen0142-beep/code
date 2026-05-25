ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cover_image_position TEXT DEFAULT '50% 50%';
