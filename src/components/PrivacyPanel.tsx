'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { backdrop, dialog, panel } from '@/lib/motion';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { IconBack } from '@/components/icons';
import { apiRequest } from '@/lib/api';
import { Avatar } from '@/components/Avatar';
import { fetchFriends, type Friend } from '@/lib/conversations';

/**
 * Réglages de confidentialité — pendant web d'`app/privacy.tsx` (mobile).
 *
 * ⚠️ Ces réglages ne sont PAS appliqués ici : le serveur filtre déjà chaque champ selon la
 * matrice (`getUserProfile`, `getRelationStatus`). Cet écran ne fait que les modifier. Rien
 * de ce qui est décidé côté client ne protège quoi que ce soit — une confidentialité vérifiée
 * dans le navigateur se contourne en modifiant le navigateur.
 */

/** Les trois valeurs communes. `privacyFriendRequests` a les siennes (amis d'amis en plus). */
const TRIPLE = ['everyone', 'friends', 'nobody'] as const;
/**
 * Les réglages de VISIBILITÉ acceptent une quatrième valeur : « mes amis, sauf… ».
 *
 * ⚠️ Absente des réglages de CONTACT (messages, appels, demandes) : y écarter quelqu'un ne
 * serait plus de la visibilité mais du blocage, qui existe déjà. Le serveur refuse d'ailleurs
 * la valeur sur ces champs-là — la liste ci-dessous doit lui rester alignée.
 */
const VISIBILITY = ['everyone', 'friends', 'friends_except', 'nobody'] as const;

/**
 * Les cinq champs qui acceptent une liste d'exclus.
 *
 * ⚠️ Un TYPE et non une liste : ici chaque ligne nomme son champ, il n'y a rien à parcourir
 * à l'exécution. C'est le compilateur qui empêche d'ouvrir le sélecteur sur un réglage de
 * contact, et le serveur qui refuserait la valeur si on y parvenait quand même.
 */
type ExceptField =
  | 'privacyPhoto'
  | 'privacyBio'
  | 'privacyLastSeen'
  | 'privacyLocation'
  | 'privacyPhone';
const FRIEND_REQUEST_VALUES = ['everyone', 'friends_of_friends', 'nobody'] as const;

type Privacy = {
  privacyPhoto: string;
  privacyBio: string;
  privacyLastSeen: string;
  privacyLocation: string;
  privacyPhone: string;
  privacyMessages: string;
  privacyCalls: string;
  privacyFriendRequests: string;
  locationEnabled: boolean;
  readReceipts: boolean;
};

/** Champ → clé de libellé, reprise telle quelle du mobile (mêmes mots dans les 3 langues). */
const LABEL: Record<keyof Omit<Privacy, 'locationEnabled' | 'readReceipts'>, string> = {
  privacyPhoto: 'photo',
  privacyBio: 'bio',
  privacyLastSeen: 'last_seen',
  privacyLocation: 'location',
  privacyPhone: 'phone',
  privacyMessages: 'messages',
  privacyCalls: 'calls',
  privacyFriendRequests: 'friend_requests',
};

/**
 * ⚠️ `Row` et `Toggle` sont définis HORS du composant. À l'intérieur, ils seraient recréés à
 * chaque rendu : React y voit un type de composant différent et REMONTE le sous-arbre — une
 * liste déroulante ouverte se refermerait au premier changement d'état.
 */
function Row({
  label,
  value,
  options,
  optionLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  optionLabel: (o: string) => string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1 truncate text-slate-900 dark:text-zinc-100">{label}</span>
      {/*
        ⚠️ `<select>` natif plutôt qu'une reprise de la feuille du mobile : c'est le contrôle
        idiomatique du web, navigable au clavier et lu par les lecteurs d'écran sans travail
        supplémentaire, et les navigateurs mobiles le rendent déjà comme un sélecteur natif.
      */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {optionLabel(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-slate-900 dark:text-zinc-100">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-sm text-slate-500 dark:text-zinc-400">{hint}</span>
        )}
      </span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 accent-[#1E40AF]"
      />
    </label>
  );
}

export function PrivacyPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // ⚠️ Chaîne de promesses : le `setState` vit dans un `.then`, donc après le rendu —
    // React 19 refuse le `setState` synchrone dans un effet.
    void apiRequest<{ profile?: Privacy | null }>('/users/me')
      .then((me) => {
        if (me.profile) setPrivacy(me.profile);
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, []);

  /**
   * Enregistre un réglage.
   *
   * ⚠️ Optimiste, avec RETOUR EN ARRIÈRE en cas d'échec. Le serveur valide les valeurs et
   * ignore silencieusement celles qu'il ne reconnaît pas : afficher un état qu'il n'a pas
   * retenu laisserait croire à un réglage actif qui ne l'est pas — exactement le genre de
   * mensonge qu'un écran de confidentialité ne peut pas se permettre.
   */
  /**
   * Personnes écartées, par réglage.
   *
   * ⚠️ Chargées d'emblée : la liste déroulante annonce leur NOMBRE, et attendre l'ouverture
   * du sélecteur afficherait d'abord un compte faux.
   */
  const [exceptions, setExceptions] = useState<Record<string, Friend[]>>({});
  const [exceptFor, setExceptFor] = useState<ExceptField | null>(null);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  /** Sélection EN COURS dans la fenêtre, validée seulement à sa fermeture. */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    void apiRequest<Record<string, Friend[]>>('/users/me/privacy/exceptions')
      .then(setExceptions)
      .catch(() => {});
  }, []);

  const patch = useCallback((change: Partial<Privacy>) => {
    setPrivacy((current) => {
      if (!current) return current;
      const previous = current;
      void apiRequest('/users/me/privacy', { method: 'PATCH', body: change }).catch(() => {
        setPrivacy(previous);
      });
      return { ...current, ...change };
    });
  }, []);

  /**
   * « Mes amis, sauf… » n'est pas une valeur qu'on pose : c'est une question qu'on ouvre.
   *
   * ⚠️ Le réglage n'est PAS enregistré ici. L'écrire avant que la liste existe laisserait un
   * « sauf » vide, donc un réglage qui se comporte comme « mes amis » et montre à quelqu'un
   * qu'on venait d'écarter. Valeur et liste partent ensemble, à la validation.
   */
  const ouvrirExceptions = useCallback(
    (field: ExceptField) => {
      setExceptFor(field);
      setSelected(new Set((exceptions[field] ?? []).map((f) => f.id)));
      if (!friends) void fetchFriends().then(setFriends).catch(() => setFriends([]));
    },
    [exceptions, friends],
  );

  /** Enregistre la valeur ET la liste dans le même appel — le serveur les écrit ensemble. */
  const validerExceptions = useCallback(() => {
    const field = exceptFor;
    setExceptFor(null);
    if (!field) return;
    const ids = [...selected];
    setExceptions((prev) => ({
      ...prev,
      [field]: (friends ?? []).filter((f) => selected.has(f.id)),
    }));
    setPrivacy((current) => {
      if (!current) return current;
      const previous = current;
      void apiRequest('/users/me/privacy', {
        method: 'PATCH',
        body: { [field]: 'friends_except', [`${field}Except`]: ids },
      }).catch(() => setPrivacy(previous));
      return { ...current, [field]: 'friends_except' };
    });
  }, [exceptFor, friends, selected]);

  /**
   * Valeurs et libellés d'un réglage de visibilité.
   *
   * ⚠️ Le NOMBRE d'exclus n'apparaît que sur la valeur ACTIVE : l'afficher sur l'option d'une
   * liste déroulante donnerait « Mes amis, sauf 0 » à qui n'a jamais ouvert le sélecteur.
   */
  const visibilite = (field: ExceptField, value: string) => ({
    options: VISIBILITY,
    optionLabel: (o: string) =>
      o === 'friends_except' && value === 'friends_except' && (exceptions[field] ?? []).length
        ? t('privacy_settings.friends_except_count', {
            count: (exceptions[field] ?? []).length,
          })
        : t(`privacy_settings.${o}`),
    onChange: (v: string) => {
      if (v === 'friends_except') {
        ouvrirExceptions(field);
        return;
      }
      patch({ [field]: v } as Partial<Privacy>);
    },
  });

  return (
    <motion.div
      variants={panel}
      initial="hidden"
      animate="show"
      className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-zinc-900"
    >
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-800">
        <button
          onClick={onClose}
          aria-label={t('profile.back')}
          className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
        >
          <IconBack size={20} />
        </button>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">
          {t('privacy_settings.title')}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto pb-8">
        {failed ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">{t('privacy_settings.failed')}</p>
        ) : !privacy ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">{t('common.loading')}</p>
        ) : (
          <>
            <h2 className="px-4 pt-5 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('privacy_settings.section_visibility')}
            </h2>
            <div className="divide-y divide-slate-100 dark:divide-zinc-800">
              <Row
                label={t(`privacy_settings.${LABEL.privacyPhoto}`)}
                value={privacy.privacyPhoto}
                {...visibilite('privacyPhoto', privacy.privacyPhoto)}
              />
              <Row
                label={t(`privacy_settings.${LABEL.privacyBio}`)}
                value={privacy.privacyBio}
                {...visibilite('privacyBio', privacy.privacyBio)}
              />
              <Row
                label={t(`privacy_settings.${LABEL.privacyLastSeen}`)}
                value={privacy.privacyLastSeen}
                {...visibilite('privacyLastSeen', privacy.privacyLastSeen)}
              />
              <Row
                label={t(`privacy_settings.${LABEL.privacyPhone}`)}
                value={privacy.privacyPhone}
                {...visibilite('privacyPhone', privacy.privacyPhone)}
              />
              <Toggle
                label={t('privacy_settings.location_enabled')}
                value={privacy.locationEnabled}
                onChange={(v) => patch({ locationEnabled: v })}
              />
              {/* Qui voit la localisation n'a de sens que si on la partage — même règle que
                  le mobile, et le serveur masque de toute façon la ville sans le partage. */}
              {privacy.locationEnabled && <Row
                label={t(`privacy_settings.${LABEL.privacyLocation}`)}
                value={privacy.privacyLocation}
                {...visibilite('privacyLocation', privacy.privacyLocation)}
              />}
              <Toggle
                label={t('privacy_settings.read_receipts')}
                hint={t('privacy_settings.read_receipts_hint')}
                value={privacy.readReceipts}
                onChange={(v) => patch({ readReceipts: v })}
              />
            </div>

            <h2 className="px-4 pt-6 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('privacy_settings.section_contact')}
            </h2>
            <div className="divide-y divide-slate-100 dark:divide-zinc-800">
              <Row
                label={t(`privacy_settings.${LABEL.privacyMessages}`)}
                value={privacy.privacyMessages}
                options={TRIPLE}
                optionLabel={(o) => t(`privacy_settings.${o}`)}
                onChange={(v) => patch({ privacyMessages: v })}
              />
              <Row
                label={t(`privacy_settings.${LABEL.privacyCalls}`)}
                value={privacy.privacyCalls}
                options={TRIPLE}
                optionLabel={(o) => t(`privacy_settings.${o}`)}
                onChange={(v) => patch({ privacyCalls: v })}
              />
              <Row
                label={t(`privacy_settings.${LABEL.privacyFriendRequests}`)}
                value={privacy.privacyFriendRequests}
                options={FRIEND_REQUEST_VALUES}
                optionLabel={(o) => t(`privacy_settings.${o}`)}
                onChange={(v) => patch({ privacyFriendRequests: v })}
              />
            </div>
          </>
        )}
      </div>

      {/*
        Choix des personnes écartées.
        ⚠️ `fixed inset-0` et non `absolute` : cette fenêtre doit recouvrir TOUTE la page, pas
        seulement la colonne. Le panneau de confidentialité est lui-même en `absolute inset-0`
        sur la colonne de gauche, une fenêtre absolue y serait enfermée dans 380 px.
      */}
      <AnimatePresence>
        {exceptFor && (
          <motion.div
            variants={backdrop}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={validerExceptions}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          >
            <motion.div
              variants={dialog}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900"
            >
              <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-800">
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-slate-900 dark:text-zinc-100">
                    {t('privacy_settings.except_title')}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
                    {t('privacy_settings.except_hint', {
                      field: t(`privacy_settings.${LABEL[exceptFor]}`),
                    })}
                  </p>
                </div>
                <button
                  onClick={validerExceptions}
                  className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-[#1E40AF] hover:bg-slate-100 dark:hover:bg-zinc-800"
                >
                  {t('privacy_settings.except_done')}
                </button>
              </div>

              {friends === null ? (
                <p className="px-6 py-10 text-center text-sm text-slate-400">
                  {t('common.loading')}
                </p>
              ) : friends.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-slate-400">
                  {t('privacy_settings.except_no_friends')}
                </p>
              ) : (
                <ul className="flex-1 overflow-y-auto py-1">
                  {friends.map((f) => {
                    const coche = selected.has(f.id);
                    return (
                      <li key={f.id}>
                        {/* ⚠️ Une vraie case à cocher : la sélection doit se voir AUSSI quand
                            elle est vide, sinon rien ne dit que la ligne est cochable. */}
                        <label className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-zinc-800/60">
                          <Avatar name={f.name} photoUrl={f.photoUrl} size={36} />
                          <span className="min-w-0 flex-1 truncate text-sm text-slate-900 dark:text-zinc-100">
                            {f.name}
                          </span>
                          <input
                            type="checkbox"
                            checked={coche}
                            onChange={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(f.id)) next.delete(f.id);
                                else next.add(f.id);
                                return next;
                              })
                            }
                            className="size-4 accent-[#1E40AF]"
                          />
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
