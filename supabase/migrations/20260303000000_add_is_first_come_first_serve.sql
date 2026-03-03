-- Add is_first_come_first_serve column to facility table
-- Indicates facilities that are first-come-first-serve (sans réservation)
ALTER TABLE facility
ADD COLUMN is_first_come_first_serve boolean NOT NULL DEFAULT false;
