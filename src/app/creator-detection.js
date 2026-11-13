/**
 * Conservative, explicit composer credits from NicoNico descriptions.
 * An uploader is not necessarily the composer; consumers should keep it
 * separately from the imported VocaDB/producers fields.
 */
export function creditedComposers(description) {
  const lines = String(description ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .split(/\r?\n/)
    .map((line) => line.replace(/<[^>]*>/g, '').trim());
  const creditPattern =
    /^(?:作曲|作編曲|作詞[・\/＆&]作曲|作詞作曲|composer|composed\s+by|music(?:\s*by)?)\s*[:：=／/]\s*/i;
  const authors = new Set();
  for (const line of lines) {
    if (!creditPattern.test(line)) continue;
    const field = line
      .replace(creditPattern, '')
      .split(/\s+(?:歌唱|vocal|絵|イラスト|動画|mix)\s*[:：]/i)[0];
    for (const name of field.split(/[,、;；&＆]+/)) {
      const trimmed = name.trim();
      if (trimmed && trimmed.length <= 90 && !/^https?:\/\//i.test(trimmed)) authors.add(trimmed);
    }
  }
  return [...authors];
}
