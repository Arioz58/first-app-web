import { NEXA } from '@/lib/config';

/**
 * Avatar circulaire — équivalent web de `components/UserAvatar.tsx` du mobile.
 *
 * Photo si elle existe, sinon l'initiale sur fond bleu ; deux silhouettes pour un groupe
 * sans photo. Mêmes couleurs que le mobile (`#EFF6FF` / `#1E40AF`), pour qu'un même contact
 * se reconnaisse d'un client à l'autre.
 */
export function Avatar({
  name,
  photoUrl,
  size = 48,
  group = false,
}: {
  name?: string | null;
  photoUrl?: string | null;
  size?: number;
  group?: boolean;
}) {
  if (photoUrl) {
    // Les photos viennent de CloudFront avec un domaine variable ; `next/image` exigerait
    // de le déclarer en configuration, pour un gain nul sur des vignettes de 48 px.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={name ?? ''}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        backgroundColor: '#EFF6FF',
        color: NEXA,
        fontSize: size * 0.4,
      }}
    >
      {group ? (
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
        </svg>
      ) : (
        (name?.trim()[0] ?? '?').toUpperCase()
      )}
    </div>
  );
}
