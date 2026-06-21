-- Raise rating proof video uploads from 50 MB to 100 MB.
-- NOTE: the bucket limit cannot exceed the project-global storage upload cap.
-- The global cap must also be raised to >= 100 MB in Dashboard -> Project Settings
-- -> Storage (or via the Management API), otherwise uploads 50-100 MB still 413.
update storage.buckets
set file_size_limit = 104857600
where id = 'rating-proof-videos';
