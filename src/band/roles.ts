/** Roles del ministerio de alabanza / banda. `view` decide qué ve cada quien en la JAM. */
export type RoleView = 'lyrics' | 'chords' | 'bass' | 'drums' | 'projection';

export interface Role {
  id: string;
  label: string;
  icon: string;
  view: RoleView;
}

export const ROLES: Role[] = [
  { id: 'director', label: 'Director(a) de alabanza', icon: '🙌', view: 'chords' },
  { id: 'voz', label: 'Voz principal', icon: '🎤', view: 'lyrics' },
  { id: 'coros', label: 'Coros', icon: '🎶', view: 'lyrics' },
  { id: 'guitarra', label: 'Guitarra acústica', icon: '🎸', view: 'chords' },
  { id: 'electrica', label: 'Guitarra eléctrica', icon: '⚡', view: 'chords' },
  { id: 'bajo', label: 'Bajo', icon: '🎸', view: 'bass' },
  { id: 'piano', label: 'Piano / teclado', icon: '🎹', view: 'chords' },
  { id: 'bateria', label: 'Batería', icon: '🥁', view: 'drums' },
  { id: 'percusion', label: 'Percusión', icon: '🪘', view: 'drums' },
  { id: 'violin', label: 'Violín / cuerdas', icon: '🎻', view: 'chords' },
  { id: 'vientos', label: 'Vientos', icon: '🎺', view: 'chords' },
  { id: 'sonido', label: 'Sonido', icon: '🎛', view: 'lyrics' },
  { id: 'multimedia', label: 'Multimedia / proyección', icon: '📽', view: 'projection' },
];

export const roleById = (id: string): Role => ROLES.find((r) => r.id === id) ?? ROLES[1];
