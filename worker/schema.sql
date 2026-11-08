-- One row per person per draw. Holds no names and no readable wishes: `id` is a
-- fingerprint made on the phone from the group link and the name, and `blob` is
-- the wishlist encrypted on the phone with a key made from the link.
CREATE TABLE IF NOT EXISTS wishlists (
  id      TEXT PRIMARY KEY,
  blob    TEXT NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wishlists_updated ON wishlists (updated);
