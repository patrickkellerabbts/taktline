// Zentralisierte deutsche UI-Strings. Bei Bedarf später durch next-intl o.ä. ersetzbar.

export const t = {
  app: {
    title: 'Gantt-Chart',
    description: 'Internes Projektmanagement-Tool',
  },
  nav: {
    projects: 'Projekte',
    logout: 'Abmelden',
  },
  login: {
    heading: 'Anmelden',
    subheading: 'Verwende deinen GitLab-Account, um dich anzumelden.',
    button: 'Mit GitLab anmelden',
  },
  projects: {
    heading: 'Projekte',
    empty: 'Du hast noch keine Projekte aktiviert.',
    activate: 'Projekt aktivieren',
    openGantt: 'Gantt öffnen',
  },
  gantt: {
    heading: 'Gantt-Ansicht',
    loading: 'Lade Gantt-Daten…',
    empty: 'Keine Work Packages in diesem Projekt vorhanden.',
  },
  errors: {
    unauthorized: 'Du musst angemeldet sein.',
    notFound: 'Nicht gefunden.',
    unknown: 'Ein unbekannter Fehler ist aufgetreten.',
  },
  common: {
    cancel: 'Abbrechen',
    save: 'Speichern',
    delete: 'Löschen',
    edit: 'Bearbeiten',
    loading: 'Lädt…',
  },
} as const;
