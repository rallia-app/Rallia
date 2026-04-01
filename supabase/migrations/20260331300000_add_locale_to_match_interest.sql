-- Add locale column to match_interest so emails can be sent in the visitor's language
ALTER TABLE match_interest ADD COLUMN locale TEXT NOT NULL DEFAULT 'en-US';
