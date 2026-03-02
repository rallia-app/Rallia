-- Migration: Add screenshot support to feedback table
-- Description: Adds screenshot_urls column for bug report images

-- Add screenshot_urls column (array of URLs)
ALTER TABLE public.feedback
ADD COLUMN IF NOT EXISTS screenshot_urls TEXT[] DEFAULT '{}';

-- Add comment for documentation
COMMENT ON COLUMN public.feedback.screenshot_urls IS 'Array of screenshot URLs for bug reports';
