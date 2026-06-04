-- Add referral_qr_url column to profiles
-- Stores the pre-generated QR code data URL so it only needs to be created once
alter table profiles
  add column if not exists referral_qr_url text;
