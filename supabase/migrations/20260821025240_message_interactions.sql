alter table whatsapp_hub.messages
  add column if not exists reply_to_message_id uuid references whatsapp_hub.messages(id) on delete set null,
  add column if not exists reply_preview text,
  add column if not exists reactions jsonb not null default '[]'::jsonb;

create index if not exists idx_messages_reply_to
  on whatsapp_hub.messages(reply_to_message_id)
  where reply_to_message_id is not null;

comment on column whatsapp_hub.messages.reactions is
  'Operator reactions: [{emoji,user_id,created_at}]';