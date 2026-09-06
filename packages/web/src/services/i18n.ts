export type SupportedLocale = 'en' | 'es'

export interface TranslationDictionary {
  common: {
    save: string
    cancel: string
    delete: string
    remove: string
    edit: string
    create: string
    back: string
    signOut: string
    loading: string
    all: string
    none: string
    apply: string
    clear: string
    close: string
    copy: string
    copied: string
    status: string
    actions: string
    role: string
    email: string
    user: string
    confirmSignOut: string
    signOutDescription: string
    refresh: string
  }
  auth: {
    tagline: string
    emailOrUsername: string
    identifierPlaceholder: string
    continueWithOtp: string
    registerTitle: string
    registerSubtitle: string
    displayNamePlaceholder: string
    usernamePlaceholder: string
    sendCode: string
    codeTitle: string
    codeSubtitle: string
    codePlaceholder: string
    verifyAndSignIn: string
    back: string
  }
  dashboard: {
    title: string
    subtitle: string
    projectsTitle: string
    projectsSubtitle: string
    newProject: string
    createProjectTitle: string
    projectName: string
    projectNamePlaceholder: string
    slugIdentifier: string
    slugPlaceholder: string
    description: string
    descriptionPlaceholder: string
    createRepository: string
    loadingProjects: string
    noProjects: string
    teamsButton: string
    teamsTooltip: string
    profileTooltip: string
    notificationsTitle: string
    notificationsEmpty: string
    accept: string
    decline: string
    ownerBadge: string
    editorBadge: string
    commenterBadge: string
  }
  teams: {
    title: string
    subtitle: string
    createPrivateTeam: string
    newPrivateTeamTitle: string
    teamNamePlaceholder: string
    domainTeamsTitle: string
    domainTeamsSubtitle: string
    members: string
    pendingInvites: string
    inviteMember: string
    inviteEmailPlaceholder: string
    sendInvite: string
    joinDomainTeam: string
    joinedBadge: string
  }
  projectSettings: {
    title: string
    shareTooltip: string
    gitSignatureTitle: string
    gitSignatureDesc: string
    updateSignature: string
    directMembersTitle: string
    directMembersDesc: string
    inviteDirectMember: string
    teamsAccessTitle: string
    teamsAccessDesc: string
    grantTeamAccess: string
    dangerZoneTitle: string
    dangerZoneDesc: string
    deleteProject: string
    leaveProject: string
    removeMember: string
    removeMemberDesc: string
    roleOwner: string
    roleEditor: string
    roleCommenter: string
  }
  settings: {
    title: string
    backTooltip: string
    appearanceTitle: string
    appearanceDesc: string
    themeSystem: string
    themeSystemDesc: string
    themeLight: string
    themeLightDesc: string
    themeDark: string
    themeDarkDesc: string
    languageTitle: string
    languageDesc: string
    langEn: string
    langEnDesc: string
    langEs: string
    langEsDesc: string
    profileTitle: string
    displayName: string
    username: string
    saveProfile: string
    verifiedEmailsTitle: string
    addEmail: string
    sendOtp: string
    confirmEmail: string
    sendVerificationCode: string
    agentTokensTitle: string
    agentTokensDesc: string
    createAgentToken: string
    noAgentTokens: string
    revoke: string
    setPrimary: string
    primaryBadge: string
  }
  workspace: {
    explorer: string
    newDocumentTooltip: string
    newDocPlaceholder: string
    readAndReview: string
    edit: string
    publishToMain: string
    saved: string
    saving: string
    share: string
    shareTooltip: string
    filters: string
    pendingOnly: string
    allTab: string
    commentsOnly: string
    suggestionsOnly: string
    contentType: string
    threadCreator: string
    participantReviewer: string
    multiSelectHint: string
    clearFilters: string
    cancel: string
    applyFilters: string
    commentsAndSuggestions: string
    resolved: string
    activeFiltersTooltip: string
    noFiltersTooltip: string
    replyPlaceholder: string
    reply: string
    addComment: string
    addSuggestion: string
    resolveThread: string
    reopenThread: string
    applySuggestion: string
    rejectSuggestion: string
    suggestedReplacement: string
    leaveReviewCommentPlaceholder: string
    optionalReplacementPlaceholder: string
    post: string
    renameDocTitle: string
    renameDocDesc: string
    newPathLabel: string
    newPathPlaceholder: string
    renameDocButton: string
    deleteDocTitle: string
    deleteDocDesc: string
    conflictDetectedTitle: string
    conflictDetectedDesc: string
    conflictBlockHeader: string
    yourVersionDraft: string
    remoteVersionMain: string
    keepMine: string
    keepMain: string
    applyResolutionAndPublish: string
    noDocSelected: string
    documentCreatedSuccess: string
    commentPostedSuccess: string
    publishedSuccess: string
    documentRenamedSuccess: string
    documentDeletedSuccess: string
    suggestionAppliedSuccess: string
    suggestionRejectedSuccess: string
    export: string
    exportTooltip: string
    downloadMarkdown: string
    exportHtml: string
    exportPdf: string
    exportPreparingHtml: string
    canvasWidthTooltip: string
    widthStandard: string
    widthWide: string
    widthFull: string
    table: string
    expandWidth: string
    collapseWidth: string
    toggleBreakoutTooltip: string
    codeCopied: string
  }
}

export const en: TranslationDictionary = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    remove: 'Remove',
    edit: 'Edit',
    create: 'Create',
    back: 'Back',
    signOut: 'Sign Out',
    loading: 'Loading...',
    all: 'All',
    none: 'None',
    apply: 'Apply',
    clear: 'Clear',
    close: 'Close',
    copy: 'Copy',
    copied: 'Copied!',
    status: 'Status',
    actions: 'Actions',
    role: 'Role',
    email: 'Email',
    user: 'User',
    confirmSignOut: 'Are you sure you want to sign out?',
    signOutDescription: 'You will need to sign in again to access your documentation projects.',
    refresh: 'Refresh',
  },
  auth: {
    tagline: 'Markdown for legacy people. Backed by Git.',
    emailOrUsername: 'Email or Username',
    identifierPlaceholder: 'name@company.com or username',
    continueWithOtp: 'Continue with OTP',
    registerTitle: 'Create Account',
    registerSubtitle: "Let's create your md4lp account.",
    displayNamePlaceholder: 'Alice Smith',
    usernamePlaceholder: 'alice',
    sendCode: 'Send Code',
    codeTitle: 'Verification Code',
    codeSubtitle: 'We sent a 6-digit code to',
    codePlaceholder: '123456',
    verifyAndSignIn: 'Verify & Sign In',
    back: 'Back',
  },
  dashboard: {
    title: 'Projects Dashboard',
    subtitle: 'Manage your documentation repositories',
    projectsTitle: 'Your Projects',
    projectsSubtitle: 'Select a repository workspace to edit or review documentation.',
    newProject: 'New Project',
    createProjectTitle: 'Create New Project',
    projectName: 'Project Name',
    projectNamePlaceholder: 'e.g. Platform Documentation',
    slugIdentifier: 'Slug Identifier (URL friendly)',
    slugPlaceholder: 'platform-docs',
    description: 'Description',
    descriptionPlaceholder: 'Brief summary of this knowledge base',
    createRepository: 'Create Repository',
    loadingProjects: 'Loading projects...',
    noProjects: 'No projects found. Create your first repository!',
    teamsButton: 'Teams',
    teamsTooltip: 'Teams & Organizations',
    profileTooltip: 'Settings & Account Profile',
    notificationsTitle: '🔔 Pending Invitations & Actions',
    notificationsEmpty: 'No pending notifications.',
    accept: 'Accept',
    decline: 'Decline',
    ownerBadge: 'Owner',
    editorBadge: 'Editor',
    commenterBadge: 'Commenter',
  },
  teams: {
    title: 'Teams & Organizations',
    subtitle: 'Collaborate with groups across multiple projects.',
    createPrivateTeam: '+ Create Private Team',
    newPrivateTeamTitle: 'New Private Team',
    teamNamePlaceholder: 'e.g. Core Engineering',
    domainTeamsTitle: '🏢 Corporate Domain Teams',
    domainTeamsSubtitle: 'Available domain teams auto-detected from your verified emails.',
    members: 'Members',
    pendingInvites: 'Pending Invites',
    inviteMember: 'Invite Member',
    inviteEmailPlaceholder: 'colleague@domain.com',
    sendInvite: 'Send Invite',
    joinDomainTeam: 'Join Team',
    joinedBadge: 'Member',
  },
  projectSettings: {
    title: 'Share & Repository Settings',
    shareTooltip: 'Share repository & manage access',
    gitSignatureTitle: 'Git Author Signature',
    gitSignatureDesc: 'Select which verified email address signs your Git commits and document publications in this repository.',
    updateSignature: 'Update Signature',
    directMembersTitle: 'Direct Project Members',
    directMembersDesc: 'Invite individual users directly to this repository.',
    inviteDirectMember: 'Invite Member',
    teamsAccessTitle: 'Teams with Access',
    teamsAccessDesc: 'Grant workspace access to existing teams.',
    grantTeamAccess: 'Grant Access',
    dangerZoneTitle: 'Danger Zone',
    dangerZoneDesc: 'Delete repository permanently and remove all files.',
    deleteProject: 'Delete Repository',
    leaveProject: 'Leave Project',
    removeMember: 'Remove Member',
    removeMemberDesc: 'To confirm removing member from this repository, enter the verification code sent to your email.',
    roleOwner: 'Owner',
    roleEditor: 'Editor',
    roleCommenter: 'Commenter',
  },
  settings: {
    title: 'Settings & Account',
    backTooltip: 'Back to Projects',
    appearanceTitle: 'Appearance',
    appearanceDesc: 'Customize how md4lp looks on your screen.',
    themeSystem: '💻 System',
    themeSystemDesc: 'Follow operating system',
    themeLight: '☀️ Light',
    themeLightDesc: 'Clean crisp light theme',
    themeDark: '🌙 Dark',
    themeDarkDesc: 'Focused dark theme',
    languageTitle: 'Language',
    languageDesc: 'Select your preferred user interface language.',
    langEn: '🇬🇧 English',
    langEnDesc: 'English (US / UK)',
    langEs: '🇪🇸 Español',
    langEsDesc: 'Spanish / Castellano',
    profileTitle: 'Profile Information',
    displayName: 'Display Name',
    username: 'Username (@handle)',
    saveProfile: 'Save Profile',
    verifiedEmailsTitle: 'Verified Emails',
    addEmail: 'Add another email address',
    sendOtp: 'Send OTP',
    confirmEmail: 'Confirm Email',
    sendVerificationCode: 'Send Verification Code',
    agentTokensTitle: 'Agent & Automation Tokens (MCP)',
    agentTokensDesc: 'Tokens grant AI agents and CLI tools secure access to your permitted projects.',
    createAgentToken: 'Create New Token',
    noAgentTokens: 'No active agent tokens found.',
    revoke: 'Revoke',
    setPrimary: 'Set Primary',
    primaryBadge: 'Primary',
  },
  workspace: {
    explorer: 'Explorer',
    newDocumentTooltip: 'New Document',
    newDocPlaceholder: 'path/to/document.md',
    readAndReview: '📖 Read & Review',
    edit: '✏️ Edit',
    publishToMain: 'Publish to Main ↗',
    saved: 'Saved',
    saving: 'Saving...',
    share: 'Share',
    shareTooltip: 'Share repository & manage access',
    filters: '⚙️ Filters',
    pendingOnly: 'Pending Only',
    allTab: 'All',
    commentsOnly: 'Comments',
    suggestionsOnly: 'Suggestions',
    contentType: 'Content Type',
    threadCreator: 'Thread Creator (Author)',
    participantReviewer: 'Participant / Reviewer (Thread or Reply)',
    multiSelectHint: '(Multi-select)',
    clearFilters: 'Clear Filters',
    cancel: 'Cancel',
    applyFilters: 'Apply Filters',
    commentsAndSuggestions: 'Comments & Suggestions',
    resolved: 'Resolved',
    activeFiltersTooltip: 'Active filters:',
    noFiltersTooltip: 'Filters: None active (Click to configure)',
    replyPlaceholder: 'Write a reply...',
    reply: 'Reply',
    addComment: 'Comment',
    addSuggestion: 'Suggest edit',
    resolveThread: 'Resolve',
    reopenThread: 'Reopen',
    applySuggestion: 'Apply',
    rejectSuggestion: 'Reject',
    suggestedReplacement: '💡 Suggested Replacement:',
    leaveReviewCommentPlaceholder: 'Leave a review comment...',
    optionalReplacementPlaceholder: 'Optional replacement suggestion...',
    post: 'Post',
    renameDocTitle: 'Rename / Move Document',
    renameDocDesc: 'Renaming a document will automatically update any relative Markdown links pointing to this file across the repository.',
    newPathLabel: 'New Path',
    newPathPlaceholder: 'guides/new-name.md',
    renameDocButton: 'Rename Document',
    deleteDocTitle: 'Delete Document',
    deleteDocDesc: 'Are you sure you want to delete this document? This will remove the file from the repository on main.',
    conflictDetectedTitle: '⚠️ Conflict Detected Upon Publication',
    conflictDetectedDesc: 'The document was updated on main while you were editing. Review and resolve each conflicting block below:',
    conflictBlockHeader: 'Conflict Block',
    yourVersionDraft: 'Your Version (Draft):',
    remoteVersionMain: 'Remote Version (Main):',
    keepMine: 'Keep Mine',
    keepMain: 'Keep Main',
    applyResolutionAndPublish: 'Apply Resolution & Publish',
    noDocSelected: 'No document selected.',
    documentCreatedSuccess: 'Document created successfully',
    commentPostedSuccess: 'Comment posted successfully',
    publishedSuccess: 'Published successfully to main!',
    documentRenamedSuccess: 'Document renamed successfully',
    documentDeletedSuccess: 'Document deleted successfully',
    suggestionAppliedSuccess: 'Suggestion applied successfully',
    suggestionRejectedSuccess: 'Suggestion rejected',
    export: 'Export',
    exportTooltip: 'Download or export document',
    downloadMarkdown: '📄 Download Markdown (.md)',
    exportHtml: '🌐 Export Standalone HTML (.html)',
    exportPdf: '🖨️ Print / Save as PDF (.pdf)',
    exportPreparingHtml: 'Preparing document export...',
    canvasWidthTooltip: 'Reading & editing canvas width',
    widthStandard: 'Standard',
    widthWide: 'Wide',
    widthFull: 'Full width',
    table: 'Table',
    expandWidth: 'Expand',
    collapseWidth: 'Standard',
    toggleBreakoutTooltip: 'Toggle expanded breakout width',
    codeCopied: 'Copied!',
  },
}

export const es: TranslationDictionary = {
  common: {
    save: 'Guardar',
    cancel: 'Cancelar',
    delete: 'Eliminar',
    remove: 'Quitar',
    edit: 'Editar',
    create: 'Crear',
    back: 'Volver',
    signOut: 'Cerrar Sesión',
    loading: 'Cargando...',
    all: 'Todos',
    none: 'Ninguno',
    apply: 'Aplicar',
    clear: 'Limpiar',
    close: 'Cerrar',
    copy: 'Copiar',
    copied: '¡Copiado!',
    status: 'Estado',
    actions: 'Acciones',
    role: 'Rol',
    email: 'Correo',
    user: 'Usuario',
    confirmSignOut: '¿Estás seguro de que deseas cerrar sesión?',
    signOutDescription: 'Tendrás que iniciar sesión de nuevo para acceder a tus proyectos de documentación.',
    refresh: 'Actualizar',
  },
  auth: {
    tagline: 'Markdown visual para humanos. Respaldado por Git.',
    emailOrUsername: 'Correo o Usuario',
    identifierPlaceholder: 'nombre@empresa.com o usuario',
    continueWithOtp: 'Continuar con código OTP',
    registerTitle: 'Crear Cuenta',
    registerSubtitle: 'Vamos a crear tu cuenta de md4lp.',
    displayNamePlaceholder: 'Alice Smith',
    usernamePlaceholder: 'alice',
    sendCode: 'Enviar Código',
    codeTitle: 'Código de Verificación',
    codeSubtitle: 'Hemos enviado un código de 6 dígitos a',
    codePlaceholder: '123456',
    verifyAndSignIn: 'Verificar e Iniciar Sesión',
    back: 'Volver',
  },
  dashboard: {
    title: 'Panel de Proyectos',
    subtitle: 'Gestiona tus repositorios de documentación',
    projectsTitle: 'Tus Proyectos',
    projectsSubtitle: 'Selecciona un espacio de trabajo para editar o revisar documentación.',
    newProject: 'Nuevo Proyecto',
    createProjectTitle: 'Crear Nuevo Proyecto',
    projectName: 'Nombre del Proyecto',
    projectNamePlaceholder: 'ej. Documentación de Plataforma',
    slugIdentifier: 'Identificador Slug (para URLs)',
    slugPlaceholder: 'docs-plataforma',
    description: 'Descripción',
    descriptionPlaceholder: 'Breve resumen de esta base de conocimiento',
    createRepository: 'Crear Repositorio',
    loadingProjects: 'Cargando proyectos...',
    noProjects: 'No se encontraron proyectos. ¡Crea tu primer repositorio!',
    teamsButton: 'Equipos',
    teamsTooltip: 'Equipos y Organizaciones',
    profileTooltip: 'Ajustes y Perfil de Usuario',
    notificationsTitle: '🔔 Invitaciones y Acciones Pendientes',
    notificationsEmpty: 'Sin notificaciones pendientes.',
    accept: 'Aceptar',
    decline: 'Rechazar',
    ownerBadge: 'Propietario',
    editorBadge: 'Editor',
    commenterBadge: 'Comentarista',
  },
  teams: {
    title: 'Equipos y Organizaciones',
    subtitle: 'Colabora en grupo a través de múltiples proyectos.',
    createPrivateTeam: '+ Crear Equipo Privado',
    newPrivateTeamTitle: 'Nuevo Equipo Privado',
    teamNamePlaceholder: 'ej. Ingeniería Principal',
    domainTeamsTitle: '🏢 Equipos de Dominio Corporativo',
    domainTeamsSubtitle: 'Equipos de dominio disponibles detectados automáticamente por tus correos.',
    members: 'Miembros',
    pendingInvites: 'Invitaciones Pendientes',
    inviteMember: 'Invitar Miembro',
    inviteEmailPlaceholder: 'colega@dominio.com',
    sendInvite: 'Enviar Invitación',
    joinDomainTeam: 'Unirse al Equipo',
    joinedBadge: 'Miembro',
  },
  projectSettings: {
    title: 'Compartir y Ajustes del Repositorio',
    shareTooltip: 'Compartir repositorio y gestionar acceso',
    gitSignatureTitle: 'Firma de Autor Git',
    gitSignatureDesc: 'Selecciona qué correo verificado firmará tus commits y publicaciones en este repositorio.',
    updateSignature: 'Actualizar Firma',
    directMembersTitle: 'Miembros Directos del Proyecto',
    directMembersDesc: 'Invita a usuarios individuales directamente a este repositorio.',
    inviteDirectMember: 'Invitar Miembro',
    teamsAccessTitle: 'Equipos con Acceso',
    teamsAccessDesc: 'Concede acceso al repositorio a equipos existentes.',
    grantTeamAccess: 'Conceder Acceso',
    dangerZoneTitle: 'Zona de Peligro',
    dangerZoneDesc: 'Eliminar el repositorio permanentemente y borrar todos sus archivos.',
    deleteProject: 'Eliminar Repositorio',
    leaveProject: 'Abandonar Proyecto',
    removeMember: 'Quitar Miembro',
    removeMemberDesc: 'Para confirmar la eliminación del miembro de este repositorio, introduce el código de verificación enviado a tu correo.',
    roleOwner: 'Propietario',
    roleEditor: 'Editor',
    roleCommenter: 'Comentarista',
  },
  settings: {
    title: 'Ajustes y Cuenta',
    backTooltip: 'Volver a Proyectos',
    appearanceTitle: 'Apariencia',
    appearanceDesc: 'Personaliza cómo se ve md4lp en tu pantalla.',
    themeSystem: '💻 Sistema',
    themeSystemDesc: 'Seguir tema del sistema operativo',
    themeLight: '☀️ Claro',
    themeLightDesc: 'Tema claro nítido y limpio',
    themeDark: '🌙 Oscuro',
    themeDarkDesc: 'Tema oscuro enfocado',
    languageTitle: 'Idioma',
    languageDesc: 'Selecciona tu idioma preferido para la interfaz.',
    langEn: '🇬🇧 English',
    langEnDesc: 'Inglés (US / UK)',
    langEs: '🇪🇸 Español',
    langEsDesc: 'Español / Castellano',
    profileTitle: 'Información de Perfil',
    displayName: 'Nombre Visible',
    username: 'Usuario (@handle)',
    saveProfile: 'Guardar Perfil',
    verifiedEmailsTitle: 'Correos Verificados',
    addEmail: 'Añadir otra dirección de correo',
    sendOtp: 'Enviar OTP',
    confirmEmail: 'Confirmar Correo',
    sendVerificationCode: 'Enviar Código de Verificación',
    agentTokensTitle: 'Tokens de Agentes y Automatización (MCP)',
    agentTokensDesc: 'Los tokens permiten a agentes de IA y herramientas CLI acceso seguro a tus proyectos.',
    createAgentToken: 'Crear Nuevo Token',
    noAgentTokens: 'No se encontraron tokens de agente activos.',
    revoke: 'Revocar',
    setPrimary: 'Establecer Principal',
    primaryBadge: 'Principal',
  },
  workspace: {
    explorer: 'Explorador',
    newDocumentTooltip: 'Nuevo Documento',
    newDocPlaceholder: 'ruta/hacia/documento.md',
    readAndReview: '📖 Lectura y Revisión',
    edit: '✏️ Editar',
    publishToMain: 'Publicar en Main ↗',
    saved: 'Guardado',
    saving: 'Guardando...',
    share: 'Compartir',
    shareTooltip: 'Compartir repositorio y gestionar acceso',
    filters: '⚙️ Filtros',
    pendingOnly: 'Solo Pendientes',
    allTab: 'Todos',
    commentsOnly: 'Comentarios',
    suggestionsOnly: 'Sugerencias',
    contentType: 'Tipo de Contenido',
    threadCreator: 'Creador del hilo (Autor)',
    participantReviewer: 'Participante / Revisor (Hilo o Respuesta)',
    multiSelectHint: '(Selección múltiple)',
    clearFilters: 'Limpiar Filtros',
    cancel: 'Cancelar',
    applyFilters: 'Aplicar Filtros',
    commentsAndSuggestions: 'Comentarios y Sugerencias',
    resolved: 'Resueltos',
    activeFiltersTooltip: 'Filtros activos:',
    noFiltersTooltip: 'Filtros: Ninguno activo (Clic para configurar)',
    replyPlaceholder: 'Escribe una respuesta...',
    reply: 'Responder',
    addComment: 'Comentar',
    addSuggestion: 'Sugerir cambio',
    resolveThread: 'Resolver',
    reopenThread: 'Reabrir',
    applySuggestion: 'Aplicar',
    rejectSuggestion: 'Rechazar',
    suggestedReplacement: '💡 Cambio Sugerido:',
    leaveReviewCommentPlaceholder: 'Deja un comentario de revisión...',
    optionalReplacementPlaceholder: 'Texto de reemplazo sugerido (opcional)...',
    post: 'Publicar',
    renameDocTitle: 'Renombrar / Mover Documento',
    renameDocDesc: 'Renombrar un documento actualizará automáticamente los enlaces relativos de Markdown que apunten a este archivo.',
    newPathLabel: 'Nueva Ruta',
    newPathPlaceholder: 'guias/nuevo-nombre.md',
    renameDocButton: 'Renombrar Documento',
    deleteDocTitle: 'Eliminar Documento',
    deleteDocDesc: '¿Estás seguro de que deseas eliminar este documento? Esta acción lo borrará del repositorio en main.',
    conflictDetectedTitle: '⚠️ Conflicto Detectado al Publicar',
    conflictDetectedDesc: 'El documento fue modificado en main mientras editabas. Revisa y resuelve cada bloque en conflicto a continuación:',
    conflictBlockHeader: 'Bloque de Conflicto',
    yourVersionDraft: 'Tu Versión (Borrador):',
    remoteVersionMain: 'Versión Remota (Main):',
    keepMine: 'Mantener la Mía',
    keepMain: 'Mantener Main',
    applyResolutionAndPublish: 'Aplicar Resolución y Publicar',
    noDocSelected: 'Ningún documento seleccionado.',
    documentCreatedSuccess: 'Documento creado correctamente',
    commentPostedSuccess: 'Comentario publicado correctamente',
    publishedSuccess: '¡Publicado con éxito en main!',
    documentRenamedSuccess: 'Documento renombrado correctamente',
    documentDeletedSuccess: 'Documento eliminado correctamente',
    suggestionAppliedSuccess: 'Sugerencia aplicada correctamente',
    suggestionRejectedSuccess: 'Sugerencia rechazada',
    export: 'Exportar',
    exportTooltip: 'Descargar o exportar documento',
    downloadMarkdown: '📄 Descargar Markdown (.md)',
    exportHtml: '🌐 Exportar HTML Independiente (.html)',
    exportPdf: '🖨️ Imprimir / Guardar en PDF (.pdf)',
    exportPreparingHtml: 'Preparando exportación...',
    canvasWidthTooltip: 'Ancho del lienzo de lectura y edición',
    widthStandard: 'Estándar',
    widthWide: 'Expandido',
    widthFull: 'Ancho total',
    table: 'Tabla',
    expandWidth: 'Expandir',
    collapseWidth: 'Estándar',
    toggleBreakoutTooltip: 'Alternar ancho extendido',
    codeCopied: '¡Copiado!',
  },
}

export const dictionaries: Record<SupportedLocale, TranslationDictionary> = {
  en,
  es,
}

const STORAGE_KEY = 'md4lp_locale'

class I18nManager {
  private currentLocale: SupportedLocale = 'en'
  private listeners: Set<(locale: SupportedLocale) => void> = new Set()

  constructor() {
    this.init()
  }

  private init() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as SupportedLocale | null
      if (stored && (stored === 'en' || stored === 'es')) {
        this.currentLocale = stored
      } else if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es')) {
        this.currentLocale = 'es'
      } else {
        this.currentLocale = 'en'
      }
    } catch {
      this.currentLocale = 'en'
    }
  }

  getLocale(): SupportedLocale {
    return this.currentLocale
  }

  setLocale(locale: SupportedLocale): void {
    if (this.currentLocale === locale) return
    this.currentLocale = locale
    try {
      localStorage.setItem(STORAGE_KEY, locale)
    } catch {}
    this.listeners.forEach(fn => fn(this.currentLocale))
  }

  get t(): TranslationDictionary {
    return dictionaries[this.currentLocale] || dictionaries.en
  }

  subscribe(listener: (locale: SupportedLocale) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export const i18n = new I18nManager()
