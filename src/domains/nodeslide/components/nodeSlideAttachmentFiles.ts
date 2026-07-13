import {
  NODESLIDE_CREATE_ATTACHMENT_MAX_FILES,
  type NodeSlideDataAttachment,
  type NodeSlideDataAttachmentFormat,
  normalizeNodeSlideDataAttachment,
} from '../../../../shared/nodeslideAttachments';

export async function readNodeSlideAttachmentFiles(
  files: FileList | readonly File[],
  existing: readonly NodeSlideDataAttachment[],
): Promise<NodeSlideDataAttachment[]> {
  const incoming = Array.from(files);
  if (existing.length + incoming.length > NODESLIDE_CREATE_ATTACHMENT_MAX_FILES) {
    throw new Error(`Attach at most ${NODESLIDE_CREATE_ATTACHMENT_MAX_FILES} data files.`);
  }
  const knownTitles = new Set(existing.map((attachment) => attachment.title.toLocaleLowerCase()));
  const additions: NodeSlideDataAttachment[] = [];
  for (const file of incoming) {
    const format = attachmentFormat(file.name);
    const title = file.name.trim().slice(0, 180);
    if (!title) throw new Error('Each attached file needs a name.');
    if (knownTitles.has(title.toLocaleLowerCase())) {
      throw new Error(`${title} is already attached.`);
    }
    const content = normalizeNodeSlideDataAttachment(await file.text(), format);
    knownTitles.add(title.toLocaleLowerCase());
    additions.push({ title, format, content });
  }
  return [...existing, ...additions];
}

function attachmentFormat(fileName: string): NodeSlideDataAttachmentFormat {
  const extension = fileName.toLocaleLowerCase().split('.').pop();
  if (extension === 'csv' || extension === 'json' || extension === 'txt') return extension;
  if (extension === 'md') return 'txt';
  throw new Error('Attach a CSV, JSON, TXT, or Markdown file.');
}
