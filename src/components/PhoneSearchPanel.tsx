'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/Avatar';
import { IconSearch } from '@/components/icons';
import { COUNTRIES, defaultCountry, type Country } from '@/lib/countries';
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
  searchByPhone,
  sendFriendRequest,
  type PhoneCard,
  type RecentSearch,
  type RelationStatus,
} from '@/lib/contacts';
import { startDirectConversation } from '@/lib/conversations';

/**
 * Recherche d'une personne par son NUMÉRO — pendant web d'`AddContactSheet`.
 *
 * ⚠️ Sur mobile, la carte trouvée ouvre l'écran de profil, d'où l'on peut tout faire. Le web
 * n'a pas d'écran de profil : les actions sont donc portées par la carte elle-même. C'est le
 * seul écart de fond avec le mobile, et il est imposé par ce qui existe.
 *
 * ⚠️ Le répertoire (`DirectoryPanel` sur mobile) n'a pas d'équivalent ici : un navigateur
 * n'accède pas au carnet d'adresses. Cette recherche est donc le SEUL moyen, sur le web,
 * d'atteindre quelqu'un qu'on n'a pas déjà en ami.
 */

/** ⚠️ Clés i18n et non libellés : traduites à l'affichage. */
const RELATION_KEY: Record<RelationStatus, string> = {
  self: 'list.you',
  friends: 'phone.already_contact',
  request_sent: 'phone.request_sent',
  request_received: 'relation.request_received',
  none: '',
};

/** Même délai que le mobile. L'endpoint est rate-limité : une requête par frappe le viderait. */
const DEBOUNCE_MS = 400;

export function PhoneSearchPanel({ onOpened }: { onOpened: (conversationId: string) => void }) {
  const { t } = useTranslation();
  const [country, setCountry] = useState<Country>(defaultCountry);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PhoneCard | null>(null);
  const [isSelf, setIsSelf] = useState(false);
  /**
   * ⚠️ Initialiseur PARESSEUX et non un effet : `localStorage` est lisible tout de suite, et
   * un effet afficherait une liste vide pendant une image. Le panneau ne se rend jamais côté
   * serveur (il vit dans un dialogue ouvert au clic), donc aucun risque de divergence
   * d'hydratation.
   */
  const [recent, setRecent] = useState<RecentSearch[]>(getRecentSearches);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  /**
   * ⚠️ Anti-course : une réponse lente à une saisie ancienne ne doit pas écraser le résultat
   * d'une saisie plus récente. On ignore toute réponse dont le numéro d'ordre n'est plus le
   * dernier émis — même garde que `useUserSearch` côté mobile.
   */
  const reqId = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Le minuteur ne doit pas survivre au démontage du panneau.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  /**
   * Lance la recherche, différée.
   *
   * ⚠️ Appelée depuis les GESTIONNAIRES de saisie et non depuis un effet : c'est la
   * conséquence d'une frappe, pas la synchronisation d'un état. React 19 refuse d'ailleurs
   * un `setState` synchrone dans un effet, et tout ce qui suit en fait.
   */
  const runSearch = (nextPhone: string, nextCountry: Country) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setResult(null);
    setIsSelf(false);
    setSentTo(null);

    const digits = nextPhone.replace(/\D/g, '');
    // Trop court : pas d'erreur affichée, la saisie est simplement en cours.
    if (digits.length < 6) {
      setError('');
      setLoading(false);
      return;
    }
    if (digits.length > 15) {
      setError(t('phone.invalid'));
      setLoading(false);
      return;
    }

    setError('');
    setLoading(true);
    const id = ++reqId.current;
    // ⚠️ Le zéro initial du format national saute : « 0612… » en France est « +33612… ».
    const full = nextCountry.dialCode + nextPhone.replace(/\s/g, '').replace(/^0+/, '');

    timerRef.current = setTimeout(async () => {
      try {
        const res = await searchByPhone(full);
        if (id !== reqId.current) return;
        if (!res.found) {
          setError(t('phone.not_found'));
        } else if (res.self) {
          setResult(res.user);
          setIsSelf(true);
          setError(t('phone.own_number'));
        } else {
          setResult(res.user);
          setRecent(
            addRecentSearch({
              id: res.user.id,
              name: res.user.name,
              phone: res.user.phone,
              photoUrl: res.user.photoUrl,
            }),
          );
        }
      } catch (e) {
        // Le rate limit remonte ici : le message du serveur est plus utile qu'un générique.
        if (id === reqId.current) setError((e as Error).message || t('phone.failed'));
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
  };

  const message = (userId: string) => {
    setBusy(true);
    void startDirectConversation(userId)
      .then((c) => onOpened(c.id))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const addFriend = (userId: string) => {
    setBusy(true);
    void sendFriendRequest(userId)
      .then(() => setSentTo(userId))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const card = (c: PhoneCard, showActions: boolean) => {
    const key = RELATION_KEY[c.relationStatus];
    const label = sentTo === c.id ? t('phone.request_sent') : key ? t(key) : '';
    return (
      <div className="rounded-xl border border-slate-200 p-3 dark:border-zinc-700">
        <div className="flex items-center gap-3">
          <Avatar name={c.name} photoUrl={c.photoUrl} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-slate-900 dark:text-zinc-100">{c.name}</p>
            <p className="truncate text-sm text-slate-400">{c.phone}</p>
            {label && <p className="mt-0.5 text-xs text-[#1E40AF] dark:text-blue-400">{label}</p>}
          </div>
        </div>
        {showActions && (
          <div className="mt-3 flex gap-2">
            {/* ⚠️ « Ajouter en ami » n'est proposé que si aucune relation n'existe : le
                serveur refuserait une seconde demande, et un bouton qui échoue par
                construction vaut moins qu'un bouton absent. */}
            {c.relationStatus === 'none' && sentTo !== c.id && (
              <button
                disabled={busy}
                onClick={() => addFriend(c.id)}
                className="flex-1 rounded-xl border border-[#1E40AF] py-2 text-sm font-semibold text-[#1E40AF] disabled:opacity-40 dark:text-blue-400"
              >
                {t('phone.add_friend')}
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => message(c.id)}
              className="flex-1 rounded-xl bg-[#1E40AF] py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {t('phone.send_message')}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="px-5 pb-2">
      <div className="mt-3 flex gap-2">
        {/* ⚠️ Un `<select>` natif plutôt qu'un sélecteur maison : soixante entrées, la
            recherche au clavier fournie par le navigateur, et l'accessibilité avec. Le
            mobile a son propre picker parce qu'un select natif y est peu maniable. */}
        <select
          value={country.code}
          onChange={(e) => {
            const next = COUNTRIES.find((c) => c.code === e.target.value) ?? country;
            setCountry(next);
            // Changer d'indicatif change le numéro complet : on relance.
            runSearch(phone, next);
          }}
          aria-label={t('phone.country')}
          className="rounded-xl bg-slate-100 px-3 py-2 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.dialCode}
            </option>
          ))}
        </select>
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-slate-100 px-3 dark:bg-zinc-800">
          <IconSearch size={16} className="shrink-0 text-slate-400" />
          <input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              runSearch(e.target.value, country);
            }}
            inputMode="tel"
            autoComplete="off"
            placeholder={country.example ?? t('phone.placeholder')}
            className="w-full bg-transparent py-2 text-sm outline-none dark:text-zinc-100"
          />
        </div>
      </div>

      <div className="mt-3 min-h-[120px]">
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-400">{t('phone.searching')}</p>
        ) : result ? (
          card(result, !isSelf)
        ) : error ? (
          <p className="py-6 text-center text-sm text-slate-400">{error}</p>
        ) : recent.length > 0 ? (
          <>
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t('phone.recent')}
              </span>
              <button
                onClick={() => {
                  clearRecentSearches();
                  setRecent([]);
                }}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200"
              >
                {t('phone.clear_recent')}
              </button>
            </div>
            {recent.map((r) => (
              <button
                key={r.id}
                disabled={busy}
                onClick={() => message(r.id)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-zinc-800/60"
              >
                <Avatar name={r.name} photoUrl={r.photoUrl} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-900 dark:text-zinc-100">
                    {r.name}
                  </span>
                  <span className="block truncate text-xs text-slate-400">{r.phone}</span>
                </span>
              </button>
            ))}
          </>
        ) : (
          <p className="py-6 text-center text-sm text-slate-400">
            {t('phone.hint')}
          </p>
        )}
      </div>
    </div>
  );
}
