-- adsrc-1 (8 Nov 2026): which ad a chat came from.
-- Meta puts the ad on the first message of a click-to-Messenger / click-to-WhatsApp ad:
--   Messenger / Instagram: messaging.referral (source ADS, ad_id, ads_context_data)
--   WhatsApp Cloud API:    messages[].referral (source_id, headline, ctwa_clid)
--   WhatsApp via Evolution (Baileys): message.*.contextInfo.externalAdReply (sourceId, title, ctwaClid)
-- Kept on the conversation (first ad wins) and copied to the lead made from it, so a lead / order / profit
-- can be traced back to its ad, and the ctwa_clid can go back to Meta with the Purchase later (B2).
alter table public.inbox_conversations add column if not exists ad jsonb;
alter table public.inbox_leads add column if not exists ad jsonb;
