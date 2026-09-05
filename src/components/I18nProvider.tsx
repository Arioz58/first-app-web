'use client';

import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MotionConfig } from 'framer-motion';
import { detectLanguage, initI18n, setLanguage, type Language } from '@/lib/i18n';

/**
 * Rend l'application dans la langue décidée par le SERVEUR.
 *
 * ⚠️ La langue vient du cookie lu par le layout racine, pas d'une détection côté client : le
 * serveur et le client doivent rendre le MÊME texte, sinon React signale une divergence
 * d'hydratation et toute l'interface se réécrit après coup.
 *
 * ⚠️ `initI18n` est appelé pendant le rendu et non dans un effet : les enfants traduisent dès
 * leur premier rendu. Dans un effet, le premier passage afficherait les clés brutes.
 */
export function I18nProvider({ lang, children }: { lang: Language; children: React.ReactNode }) {
  const i18n = initI18n(lang);

  useEffect(() => {
    /**
     * Premier passage sans cookie : on adopte la langue du navigateur et on la retient.
     *
     * ⚠️ Dans un EFFET, donc après l'hydratation : changer la langue pendant le rendu
     * produirait exactement la divergence qu'on cherche à éviter. Le premier écran s'affiche
     * dans la langue par défaut, puis bascule — une seule fois, à la toute première visite.
     */
    if (typeof document !== 'undefined' && !document.cookie.includes('nexa.lang=')) {
      const detected = detectLanguage();
      if (detected !== lang) setLanguage(detected);
    }
  }, [lang]);

  /**
   * ⚠️ `reducedMotion="user"` respecte `prefers-reduced-motion` du système, pour TOUTE
   * l'application d'un coup. Ce n'est pas une option de confort : les animations de
   * déplacement provoquent des nausées chez une partie des utilisateurs, et une interface
   * qu'on ne peut pas calmer leur devient inutilisable. Framer Motion neutralise alors les
   * translations et les échelles en gardant les fondus, ce qui laisse l'interface lisible.
   */
  return (
    <I18nextProvider i18n={i18n}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </I18nextProvider>
  );
}
