import { apiRequest } from './api';

/**
 * Téléversement d'un fichier vers S3 — même pipeline que le mobile.
 *
 * ⚠️ Le binaire ne passe JAMAIS par le backend : il demande une URL signée, le navigateur
 * envoie le fichier directement à S3, et seule l'URL CloudFront finit en base. C'est ce qui
 * permet d'envoyer une vidéo sans faire transiter des dizaines de mégaoctets par l'API.
 */

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'gif';

/** Déduit le type métier depuis le MIME — le serveur range déjà par dossier de son côté. */
export const mediaKindOf = (mime: string): MediaKind => {
  if (mime === 'image/gif') return 'gif';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
};

/**
 * Téléverse et renvoie l'URL publique.
 *
 * ⚠️ Le `PUT` vers S3 se fait avec `fetch` NU, sans passer par `apiRequest` : l'URL signée
 * n'est pas notre API, et y ajouter l'en-tête `Authorization` ferait échouer la signature.
 * ⚠️ Le `Content-Type` doit être EXACTEMENT celui déclaré à la signature, sinon S3 refuse.
 */
export const uploadFile = async (file: File, folder: 'chat' | 'stories' = 'chat') => {
  const { uploadUrl, publicUrl } = await apiRequest<{ uploadUrl: string; publicUrl: string }>(
    '/upload/presigned-url',
    { method: 'POST', body: { contentType: file.type, folder } },
  );

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!res.ok) {
    // ⚠️ S3 répond en XML, pas en JSON : son message (`SignatureDoesNotMatch`,
    // `AccessDenied`…) est la seule information exploitable pour diagnostiquer.
    const body = await res.text().catch(() => '');
    const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1];
    throw new Error(`S3 ${res.status}${code ? ` (${code})` : ''}`);
  }

  return publicUrl;
};

/** Taille lisible, pour les cartes de document. */
export const formatFileSize = (bytes?: number | null): string => {
  if (!bytes) return '';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};
