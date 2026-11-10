/** Client-side music discovery. Heuristics are based on supplied metadata/tags,
 * not audio analysis; no user notes or source singer names are overwritten. */
import {array} from './lib.js';

const VOICE_ALIASES = [
  ['音街ウナ', /音街\s*ウナ|otomachi\s*una|una\s*(?:spicy|sugar)/i],
  ['重音テト', /重音\s*テト|kasane\s*teto/i],
  ['初音ミク', /初音\s*ミク|hatsune\s*miku/i],
  ['足立レイ', /足立\s*レイ|adachi\s*rei/i],
  ['宮舞モカ', /宮舞\s*モカ|miyamai\s*moca/i],
  ['東北きりたん', /東北\s*きりたん|tohoku\s*kiritan/i],
  ['結月ゆかり', /結月\s*ゆかり|yuzuki\s*yukari/i],
  ['琴葉茜', /琴葉\s*茜/i], ['琴葉葵', /琴葉\s*葵/i],
  ['可不', /(?:^|[\s「『(/])可不(?:$|[\s」』)/])/i],
  ['星界', /(?:^|[\s「『(/])星界(?:$|[\s」』)/])/i],
  ['つくよみちゃん', /つくよみちゃん/i],
  ['ナースロボ＿タイプＴ', /ナースロボ[_＿\s]*タイプ[tｔＴ]/i],
  ['ずんだもん', /ずんだもん/i],
  ['小春六花', /小春\s*六花/i],
  ['花隈千冬', /花隈\s*千冬/i],
  ['夏色花梨', /夏色\s*花梨/i],
  ['GUMI', /\bGUMI\b|megpoid/i],
  ['IA', /(?:^|[\s「『(/])IA(?:$|[\s」』)/])/i],
  ['鏡音リン', /鏡音\s*リン/i], ['鏡音レン', /鏡音\s*レン/i],
  ['巡音ルカ', /巡音\s*ルカ/i], ['MEIKO', /\bMEIKO\b/i], ['KAITO', /\bKAITO\b/i],
];

export function canonicalVoice(value) {
  const original=String(value||'').trim();
  if(!original)return '';
  const found=VOICE_ALIASES.find(([,re])=>re.test(original));
  if(found)return found[0];
  return original.replace(/^(?:synthesizer\s*v(?:\s*ai)?|cevio\s*ai|vocaloid\s*[456]?|utau)\s*[:：-]?\s*/i,'')
    .replace(/\s*\((?:unknown|不明)\)\s*$/i,'').replace(/\s*[-–]\s*(?:sv|ai)\s*$/i,'').trim()||original;
}
function splitVerified(s) {return String(s||'').split(/[,、;；\n/&＋+]+/).map(x=>x.trim()).filter(Boolean);}
export function rawVoices(video) {
  const verified=video?.userMeta?.verified_voice;
  return verified?.trim()?splitVerified(verified):array(video?.voices).map(String).filter(Boolean);
}
export function canonicalVoices(video) {
  const result=new Set();
  for(const voice of rawVoices(video)) {
    const matched=VOICE_ALIASES.filter(([,re])=>re.test(voice)).map(([name])=>name);
    for(const name of matched.length?matched:[canonicalVoice(voice)])if(name)result.add(name);
  }
  return [...result];
}
export function voiceStats(rows,mode='canonical',limit=12) {
  const counts=new Map();
  for(const row of rows){
    const names=mode==='raw'?rawVoices(row):canonicalVoices(row);
    for(const name of new Set(names))counts.set(name,(counts.get(name)||0)+1);
  }
  return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ja')).slice(0,limit);
}

const GENRES = [
  ['ロック', /(?:ボカロック|vocarock|ロック|\brock\b|ギターロック|オルタナ|パンク)/i],
  ['ポップ', /(?:ボカポップ|vocapop|ポップ|\bpop\b|シティポップ)/i],
  ['電子音楽・EDM', /(?:エレクトロ|エレクトロニカ|テクノ|ハウス|\bedm\b|ドラムンベース|dnb|d&b|トランス|dubstep|シンセウェーブ)/i],
  ['ジャズ・ファンク', /(?:ジャズ|\bjazz\b|ファンク|\bfunk\b|スウィング)/i],
  ['バラード', /(?:バラード|ballad)/i],
  ['メタル', /(?:メタル|metal)/i],
  ['ヒップホップ・ラップ', /(?:ヒップホップ|ラップ|hip.?hop|\brap\b)/i],
  ['和風・民族音楽', /(?:和風|民謡|民族音楽|フォーク|和楽器|ケルト)/i],
  ['クラシック・吹奏楽', /(?:クラシック|classical|吹奏楽|マーチ|行進曲|オーケストラ)/i]
];
const MOODS = [
  ['元気・明るい', /(?:元気が出る|元気になる|明るい|楽しい|ハッピー|ポジティブ|爽快|アップテンポ|テンションが上がる)/i],
  ['かわいい・癒し', /(?:かわいい|可愛い|キュート|癒し|ゆるふわ|ほのぼの|ほっこり)/i],
  ['切ない・感動', /(?:切ない|せつない|泣ける|感動|エモい|哀愁|悲しい|ノスタルジ|郷愁|涙腺)/i],
  ['ダーク・不穏', /(?:ダーク|不穏|不気味|怖い|狂気|鬱|病み|ホラー|陰鬱|不安)/i],
  ['落ち着く・静か', /(?:落ち着|静か|しっとり|穏やか|チル|\bchill\b|アンビエント)/i],
  ['疾走感・激しい', /(?:疾走感|激しい|ハード|爆速|高速|ド迫力|熱い)/i],
];
export const GENRE_LABELS=GENRES.map(([name])=>name);
export const MOOD_LABELS=MOODS.map(([name])=>name);
export function genreLabels(video) {
  const text=[video?.genre,...array(video?.tags),...array(video?.vocadb_tags)].join(' ');
  return GENRES.filter(([,re])=>re.test(text)).map(([name])=>name);
}
export function moodLabels(video) {
  // Mood is *only* an inference from explicit tags. It is not verified audio analysis.
  const text=[...array(video?.tags),...array(video?.vocadb_tags)].join(' ');
  return MOODS.filter(([,re])=>re.test(text)).map(([name])=>name);
}
export function composerNames(video) {
  const verified=video?.userMeta?.verified_composer?.trim();
  return [...new Set([...(verified?splitVerified(verified):[]),...array(video?.producers),...array(video?.composers),video?.uploader].map(x=>String(x||'').trim()).filter(Boolean))];
}
export function filteredDiscovery(rows, filters={}) {
  const needle=String(filters.q||'').toLocaleLowerCase();
  const composer=String(filters.creator||'').trim().toLocaleLowerCase();
  return rows.filter(v=>{
    if(filters.playlist&&!v.memberships?.some(m=>m.id===filters.playlist))return false;
    if(filters.duplicates&&v.memberships?.length<2)return false;
    if(filters.favorites&&!v.userMeta?.favorite)return false;
    // Workflow filters help find videos still needing manual organization.
    if(filters.status==='unlisted' && v.memberships?.length)return false;
    if(filters.status==='no-voice' && canonicalVoices(v).length)return false;
    if(filters.status==='unrated' && Number(v.userMeta?.rating||0)>0)return false;
    if(filters.status==='missing-metadata' &&
       v.thumb && v.published_at && v.title && v.title!==v.id && array(v.tags).length)return false;
    if(filters.voice&&!canonicalVoices(v).includes(filters.voice))return false;
    if(filters.variant&&!rawVoices(v).includes(filters.variant))return false;
    if(filters.genre&&!genreLabels(v).includes(filters.genre))return false;
    if(filters.mood&&!moodLabels(v).includes(filters.mood))return false;
    if(filters.year&&String(v.published_at||'').slice(0,4)!==String(filters.year))return false;
    if(composer&&!composerNames(v).some(x=>x.toLocaleLowerCase().includes(composer)))return false;
    if(needle){
      const text=[v.title,v.id,v.description,v.uploader,...rawVoices(v),...canonicalVoices(v),...array(v.producers),...array(v.composers),...array(v.tags),v.userMeta?.memo,v.userMeta?.personal_tags].join(' ').toLocaleLowerCase();
      if(!text.includes(needle))return false;
    }
    return true;
  });
}
export function voiceVariants(rows,voice) {
  const variants=new Set();
  for(const row of rows)if(canonicalVoices(row).includes(voice))for(const raw of rawVoices(row))if(canonicalVoice(raw)===voice)variants.add(raw);
  return [...variants].sort((a,b)=>a.localeCompare(b,'ja'));
}
export function inferredVoicesFromTags(tags) {
  const result=new Set();
  // Variants are only retained when the tag explicitly supplies that variant.
  for(const entry of array(tags)){
    const tag=String(entry);
    for(const [name,re] of VOICE_ALIASES){
      if(!re.test(tag))continue;
      if(name==='音街ウナ'){
        if(/spicy/i.test(tag))result.add('音街ウナ Spicy');
        else if(/sugar/i.test(tag))result.add('音街ウナ Sugar');
        else if(/synthesizer\s*v\s*(?:ai)?\s*音街ウナ/i.test(tag))result.add('Synthesizer V AI 音街ウナ');
        else if(/音街ウナ[-_\s]*sv/i.test(tag))result.add('音街ウナ-SV');
        else result.add('音街ウナ');
      }else if(name==='重音テト' && /(?:重音テト[-_\s]*sv|synthesizer\s*v.*重音テト)/i.test(tag))result.add('重音テトSV');
      else result.add(name);
    }
  }
  return [...result];
}
export function needsMetadata(video,{now=Date.now(),minAgeDays=21}={}) {
  if(video?.metadata_updated_at && now-Date.parse(video.metadata_updated_at)<minAgeDays*86400000)return false;
  return !video?.thumb||!video?.published_at||!video?.title||video.title===video.id||!array(video.tags).length;
}
const META_STRING_FIELDS=['title','description','uploader','uploader_id','thumb','genre','published_at'];
const META_NUMBER_FIELDS=['duration','views','comments','mylists','likes'];
export function mergeMetadata(old,remote,{refresh=false}={}) {
  if(!old||!remote||old.id!==remote.id)throw new Error('動画IDが一致しないためメタデータを保存できません');
  const patch={id:old.id};
  for(const key of META_STRING_FIELDS){
    const value=String(remote[key]??'').trim();
    if(value&&(refresh||!String(old[key]||'').trim()||(key==='title'&&old.title===old.id)))patch[key]=value;
  }
  for(const key of META_NUMBER_FIELDS){
    const value=remote[key];
    if(value!==undefined&&value!==null&&Number.isFinite(Number(value))&&(refresh||old[key]==null))patch[key]=Math.max(0,Number(value));
  }
  for(const key of ['tags','voices']) {
    const fetched=array(remote[key]).filter(x=>typeof x==='string').slice(0,120);
    // Never discard existing VocaDB-enriched credits/voices on an automatic refresh.
    if(fetched.length&&!array(old[key]).length)patch[key]=fetched;
  }
  patch.metadata_updated_at=new Date().toISOString();
  return patch;
}
