-- One row per person per draw. Holds no names and no readable wishes: `id` is a
-- fingerprint made on the phone from the group link and the name, and `blob` is
-- the wishlist encrypted on the phone with a key made from the link.
CREATE TABLE IF NOT EXISTS wishlists (
  id      TEXT PRIMARY KEY,
  blob    TEXT NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wishlists_updated ON wishlists (updated);

-- "Jeg køber den": one row per reserved wish. `list` is the same fingerprint as
-- wishlists.id, `wish` a random id inside the encrypted list, and `holder` a
-- fingerprint of a secret on the reserving phone. No names, no wish text.
CREATE TABLE IF NOT EXISTS reservations (
  list    TEXT NOT NULL,
  wish    TEXT NOT NULL,
  holder  TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (list, wish)
);
CREATE INDEX IF NOT EXISTS reservations_updated ON reservations (updated);
