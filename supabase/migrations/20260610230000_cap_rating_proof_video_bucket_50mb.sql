-- Cap rating proof video uploads at 50 MB, matching the project-global storage upload limit.
-- The 500 MB limit was sized for the Backblaze fallback that was never enabled.
update storage.buckets
set file_size_limit = 52428800
where id = 'rating-proof-videos';
