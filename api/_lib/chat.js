import {db} from './db.js';
import {generateAgentResponse} from './yandex.js';
const wait = ms => new Promise(r => setTimeout(r, ms));

export async function handleUserMessage({telegramUserId, text, source, externalMessageId, profile = {}}) {
  if (!telegramUserId || !text?.trim()) throw new Error('Invalid message');
  text = text.trim().slice(0, 4000); const s = db();
  const {data:user,error:ue}=await s.from('gpt_users').upsert({telegram_user_id:String(telegramUserId),username:profile.username||null,first_name:profile.first_name||null,updated_at:new Date().toISOString()},{onConflict:'telegram_user_id'}).select().single(); if(ue)throw ue;
  let {data:conv}=await s.from('gpt_conversations').select('*').eq('user_id',user.id).eq('active',true).maybeSingle();
  if(!conv){const q=await s.from('gpt_conversations').insert({user_id:user.id}).select().single();if(q.error)throw q.error;conv=q.data}
  const key=`${source}:${externalMessageId}`; const {data:existing}=await s.from('gpt_messages').select('*').eq('idempotency_key',key).maybeSingle();
  if(existing){const {data:a}=await s.from('gpt_messages').select('*').eq('reply_to_id',existing.id).eq('role','assistant').maybeSingle();return{userMessage:existing,assistantMessage:a,deduplicated:true}}
  let locked=false; for(let i=0;i<30&&!locked;i++){const q=await s.from('gpt_conversations').update({processing:true,updated_at:new Date().toISOString()}).eq('id',conv.id).eq('processing',false).select('id');locked=!!q.data?.length;if(!locked)await wait(200)} if(!locked)throw new Error('Conversation is busy');
  try {
    const q=await s.from('gpt_messages').insert({conversation_id:conv.id,telegram_user_id:String(telegramUserId),role:'user',content:text,source,idempotency_key:key,external_message_id:String(externalMessageId)}).select().single();
    if(q.error){if(q.error.code==='23505'){const {data:u}=await s.from('gpt_messages').select('*').eq('idempotency_key',key).single();const {data:a}=await s.from('gpt_messages').select('*').eq('reply_to_id',u.id).eq('role','assistant').maybeSingle();return{userMessage:u,assistantMessage:a,deduplicated:true}}throw q.error}
    const {data:history}=await s.from('gpt_messages').select('role,content').eq('conversation_id',conv.id).order('created_at',{ascending:false}).limit(30);
    const answer=(await generateAgentResponse([{role:'system',content:'Ты самостоятельный универсальный ИИ-агент. Помогай с вопросами, идеями, текстами, анализом и повседневными задачами. Ты не связан с играми и игровой экономикой. Отвечай на языке пользователя.'},...(history||[]).reverse().map(m=>({role:m.role,content:m.content}))])).slice(0,12000);
    const a=await s.from('gpt_messages').insert({conversation_id:conv.id,telegram_user_id:String(telegramUserId),role:'assistant',content:answer,source:'system',reply_to_id:q.data.id,idempotency_key:`reply:${key}`}).select().single();if(a.error)throw a.error;
    return {userMessage:q.data,assistantMessage:a.data,deduplicated:false};
  } finally { await s.from('gpt_conversations').update({processing:false,updated_at:new Date().toISOString()}).eq('id',conv.id); }
}
export async function newConversation(telegramUserId){const s=db(),{data:u}=await s.from('gpt_users').select('id').eq('telegram_user_id',String(telegramUserId)).maybeSingle();if(!u)return;await s.from('gpt_conversations').update({active:false,processing:false}).eq('user_id',u.id).eq('active',true)}
