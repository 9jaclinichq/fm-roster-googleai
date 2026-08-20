-- ====================================================================
-- Migration 65: seed the 23 approved workforce email mappings
-- (Share-Ready Organisation Onboarding Polish — email/login slice)
-- ====================================================================
-- Applies ONLY the 23 SAFE TO SEED mappings from the live-data
-- reconciliation performed via a scoped, read-only service-role query
-- (workforce.id, full_name, email only — no resident_code, no admin
-- codes, no DB-password path; see this slice's own reconciliation
-- report for the full table). Every id below is the literal,
-- pre-resolved output of that human-reviewed reconciliation — no
-- surname/fuzzy matching happens in this SQL at all.
--
-- Every statement is guarded by `AND email IS NULL`, so this migration
-- can never overwrite a different existing email even if re-run or if a
-- ordering assumption is ever wrong — structurally, not just by review.
-- Dr. Olanipekun is intentionally NOT included here — his workforce.email
-- already exactly matches the supplied source value (ALREADY CORRECT in
-- the reconciliation), so there is nothing to seed for him.
--
-- Deliberately NOT included (per the locked reconciliation decisions):
--   - Dr. Adepitan, Dr. Akappo, Dr. Alawode, Dr. Dada, Dr. Ikor,
--     Dr. Ovolen, Dr. Ulasi — no supplied email; these 7 active members
--     remain NULL and rely entirely on the post-login capture flow
--     (migration 64's resident_set_email RPC).
--   - "Dr Akachukwu" — does not correspond to any active workforce row;
--     not guessed or mapped to anyone.
--
-- Rollback: a companion `UPDATE workforce SET email = NULL WHERE id IN
-- (<the 23 ids below>);` restores the pre-migration state exactly, since
-- these are pure value-sets with no dependent writes.
--
-- Verification (read-only, run after applying):
--   SELECT id, full_name, (email IS NOT NULL) AS has_email
--   FROM workforce WHERE id IN (<the 23 ids below>);
-- Expect all 23 rows has_email = true, and exactly 8 other active
-- workforce rows (the 7 no-email members + none else) still NULL.

UPDATE workforce SET email = 'timothysure4@gmail.com' WHERE id = '067fdd5a-d96f-4738-8549-d2dc5bf619df' AND email IS NULL; -- Dr. Adebayo
UPDATE workforce SET email = 'adegokeifeoluwat@gmail.com' WHERE id = '1bfecf46-3bf5-466e-9af1-851d61dd8e53' AND email IS NULL; -- Dr. Adegbenro
UPDATE workforce SET email = 'rexiegal2000@yahoo.com' WHERE id = 'db1b6fc4-8922-4fae-ad9d-0a18242e43a2' AND email IS NULL; -- Dr. Adeusi
UPDATE workforce SET email = 'oyindamolaafolabi1@yahoo.com' WHERE id = 'f8d876c5-6d06-4fd8-ad72-cb5e9c7964f5' AND email IS NULL; -- Dr. Afolabi
UPDATE workforce SET email = 'banjiheights@gmail.com' WHERE id = 'b68da439-07f3-4344-9b4d-0fb4fa39b5e3' AND email IS NULL; -- Dr. Apata
UPDATE workforce SET email = 'sertolicell1990@gmail.com' WHERE id = '62434477-9898-4510-b34d-62039e02c4fa' AND email IS NULL; -- Dr. Asimiyu (lowercased per idx_workforce_email_unique)
UPDATE workforce SET email = 'paulaworanti@gmail.com' WHERE id = '2e6b6717-0e92-4e87-869a-5f5f72951a73' AND email IS NULL; -- Dr. Aworanti
UPDATE workforce SET email = 'iseoluwa1993@yahoo.com' WHERE id = '93980961-c07c-4799-928e-ce543a029415' AND email IS NULL; -- Dr. Ayandokun
UPDATE workforce SET email = 'infomayowababatunde@gmail.com' WHERE id = '9dd1f6aa-a74f-46e7-984a-6b314f6622ae' AND email IS NULL; -- Dr. Babatunde
UPDATE workforce SET email = 'folasadeamoo@yahoo.com' WHERE id = '0271fbff-e3d2-4304-b03f-6872fa9230e5' AND email IS NULL; -- Dr. Ibiyemi
UPDATE workforce SET email = 'yagaziereamara1@gmail.com' WHERE id = '5e7f14b2-c469-41f3-bb95-dfe2e07a65a7' AND email IS NULL; -- Dr. Ihedioha
UPDATE workforce SET email = 'oluwaseunomidiora@gmail.com' WHERE id = 'aa8ce2cd-dc8f-41d2-982e-dbdebb420016' AND email IS NULL; -- Dr. Iyiola
UPDATE workforce SET email = 'ibironkeajadi@gmail.com' WHERE id = '4ddeef43-0c15-40c8-9c51-ab58bf2a5cf8' AND email IS NULL; -- Dr. Lawal
UPDATE workforce SET email = 'kaphy16@gmail.com' WHERE id = 'a1fcb866-7d21-4f02-8809-1164ac0ceb60' AND email IS NULL; -- Dr. Muibi
UPDATE workforce SET email = 'pearluchi@gmail.com' WHERE id = 'c63009a6-5175-461a-a751-e495825f9234' AND email IS NULL; -- Dr. Nwankwo
UPDATE workforce SET email = 'olorundaogunleye@gmail.com' WHERE id = '65a6c15b-c9ec-44c8-b962-ebb2c9d968bb' AND email IS NULL; -- Dr. Ogunleye
UPDATE workforce SET email = 'olamidebanks25@gmail.com' WHERE id = '01417305-65a0-4b21-b9dd-d4176ab495f0' AND email IS NULL; -- Dr. Ogunyemi
UPDATE workforce SET email = 'okohmarymaritha@gmail.com' WHERE id = '149a9314-cd44-49a9-a758-8cd67c130233' AND email IS NULL; -- Dr. Okoh
UPDATE workforce SET email = 'olatunjioluwaseun24@gmail.com' WHERE id = 'f6b0ea00-8b0b-42bc-91c6-0c5dfa48d707' AND email IS NULL; -- Dr. Olatunji
UPDATE workforce SET email = 'olujifemi@gmail.com' WHERE id = '4dece355-6e50-49a4-8b5e-e31813184bad' AND email IS NULL; -- Dr. Olujitan
UPDATE workforce SET email = 'danonpraise@yahoo.co.uk' WHERE id = '0d6a7692-1ae4-4827-abb5-ef2ff7ae6fc1' AND email IS NULL; -- Dr. Onigbinde
UPDATE workforce SET email = 'patochukwu@gmail.com' WHERE id = 'f815812d-8295-4fd3-8d86-ceeb38eade0d' AND email IS NULL; -- Dr. Ugwueze
UPDATE workforce SET email = 'nwanneumaukwu@gmail.com' WHERE id = '7b55628a-a56f-4ab9-b20a-45169f3f031e' AND email IS NULL; -- Dr. Umaukwu

-- ====================================================================
-- END OF MIGRATION 65
-- ====================================================================
