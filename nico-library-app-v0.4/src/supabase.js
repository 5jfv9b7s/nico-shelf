import { createClient } from '@supabase/supabase-js';

const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured=Boolean(url&&key);
export const client=configured?createClient(url,key,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'implicit'}
}):null;

export async function fetchAll(table,owner_id,{fields='*',size=400}={}){
  const all=[];for(let offset=0;;offset+=size){
    const {data,error}=await client.from(table).select(fields).eq('owner_id',owner_id).order(table==='entries'?'video_id':table==='playlists'?'id':table==='user_meta'?'video_id':'id').range(offset,offset+size-1);
    if(error)throw error;
    all.push(...(data||[]));if((data||[]).length<size)break;
    if(offset>500000)throw new Error('読み込み件数が上限を超えました');
  }return all;
}
export async function loadLibrary(owner_id){
  const [playlists,videos,entries,meta]=await Promise.all(['playlists','videos','entries','user_meta'].map(t=>fetchAll(t,owner_id)));
  return {playlists,videos,entries,meta};
}
export async function upsertChunks(table,items,conflict,size=50,onProgress=()=>{}){
  for(let i=0;i<items.length;i+=size){
    const {error}=await client.from(table).upsert(items.slice(i,i+size),{onConflict:conflict});
    if(error)throw new Error(`${table} ${i+1}〜${Math.min(items.length,i+size)}件: ${error.message}`);
    onProgress(table,Math.min(items.length,i+size),items.length);
  }
}
export async function importRows(owner_id,rows,onProgress){
  await upsertChunks('playlists',rows.playlists.map(x=>({...x,owner_id})),'owner_id,id',75,onProgress);
  await upsertChunks('videos',rows.videos.map(x=>({...x,owner_id})),'owner_id,id',25,onProgress);
  await upsertChunks('entries',rows.entries.map(x=>({...x,owner_id})),'owner_id,playlist_id,video_id',75,onProgress);
  await upsertChunks('user_meta',rows.meta.map(x=>({...x,owner_id})),'owner_id,video_id',75,onProgress);
}
