-- Add 'missing_court' to the feedback category check constraint
ALTER TABLE feedback DROP CONSTRAINT feedback_category_check;
ALTER TABLE feedback ADD CONSTRAINT feedback_category_check
  CHECK (category = ANY (ARRAY['bug'::text, 'feature'::text, 'improvement'::text, 'missing_court'::text, 'other'::text]));
