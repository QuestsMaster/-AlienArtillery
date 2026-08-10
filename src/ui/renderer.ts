import { GAME_CONFIG } from '../game/config';
import type { TerrainSnapshot } from '../game/terrain';
import type { AlienState, GameEvent, MatchState, Vec2 } from '../game/types';
import type { Camera } from './camera';
import { controlLayout } from './controls';
import type { ControlId, SafeAreaInsets } from './controls';

export interface CanvasRendererOptions {
  readonly getSafeArea?: () => Partial<SafeAreaInsets>;
  readonly nowMilliseconds?: () => number;
  readonly createTerrainCanvas?: () => HTMLCanvasElement;
}

const HUMAN_PALETTE = { body: '#52d6ca', shade: '#238f91', visor: '#efffff', antenna: '#a8fff1' };
const CPU_PALETTE = { body: '#ef8b74', shade: '#b94f54', visor: '#fff0bf', antenna: '#ffd7a5' };

interface TimedEffect {
  readonly event: GameEvent;
  readonly expiresAt: number;
}

export interface RosterPortraitCell {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

const ROSTER_GAP = 5;
const ROSTER_MAX_SIZE = 56;
// Keeps the canvas roster below the fixed safe-area-aware offline/update panel.
const ROSTER_STATUS_CLEARANCE = 64;
const ROSTER_RECOVERY_HUD_GAP = 16;

export function rosterLayout(viewport: Vec2, safe: SafeAreaInsets): readonly RosterPortraitCell[] {
  const contentWidth = viewport.x - safe.left - safe.right;
  const size = Math.min(ROSTER_MAX_SIZE, (contentWidth - ROSTER_GAP * 5) / 6);
  const rowWidth = size * 6 + ROSTER_GAP * 5;
  const startX = safe.left + (contentWidth - rowWidth) / 2;

  return Array.from({ length: 6 }, (_, index) => ({
    x: startX + index * (size + ROSTER_GAP),
    y: safe.top + ROSTER_STATUS_CLEARANCE,
    size,
  }));
}

/** The first safe canvas row available to a non-empty DOM recovery/status panel. */
export function recoveryHudTop(viewport: Vec2, safe: SafeAreaInsets): number {
  const firstPortrait = rosterLayout(viewport, safe)[0];
  return firstPortrait.y + firstPortrait.size + ROSTER_RECOVERY_HUD_GAP;
}

export class CanvasRenderer {
  private readonly context: CanvasRenderingContext2D;
  private effects: TimedEffect[] = [];
  private lastEvents: readonly GameEvent[] | null = null;
  private readonly terrainCanvas: HTMLCanvasElement | null;
  private retainedTerrain: TerrainSnapshot | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: CanvasRendererOptions = {},
  ) {
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Canvas 2D context is unavailable');
    this.context = context;
    this.terrainCanvas = options.createTerrainCanvas?.()
      ?? (typeof document === 'undefined' ? null : document.createElement('canvas'));
  }

  render(match: MatchState, terrain: TerrainSnapshot, camera: Camera): void {
    this.updateEffects(match.events);
    this.resize(camera);
    if (camera.viewport.x <= camera.viewport.y) {
      this.context.clearRect(0, 0, camera.viewport.x, camera.viewport.y);
      this.drawRotateOverlay(camera);
      return;
    }
    this.drawBackground(camera);

    const context = this.context;
    context.save();
    context.translate(camera.viewport.x / 2, camera.viewport.y / 2);
    context.scale(camera.zoom, camera.zoom);
    context.translate(-camera.center.x, -camera.center.y);

    this.drawTerrain(terrain);
    const active = match.aliens.filter(alien => alien.team === match.activeTeam)[match.activeAlienIndex[match.activeTeam]];
    match.aliens.forEach(alien => this.drawAlien(alien, alien.id === active?.id));
    if (match.projectile !== null) this.drawProjectile(match.projectile.position, match.projectile.weapon);
    this.effects.forEach(effect => this.drawEvent(effect.event, match));
    this.drawTrajectoryPreview(match);
    context.restore();

    this.drawHud(match, camera);
    if (match.phase === 'complete') this.drawWinner(match, camera);
    else this.drawTouchControls(camera);
  }

  private resize(camera: Camera): void {
    const width = Math.max(1, Math.round(camera.viewport.x));
    const height = Math.max(1, Math.round(camera.viewport.y));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  private drawBackground(camera: Camera): void {
    const sky = this.context.createLinearGradient(0, 0, 0, camera.viewport.y);
    sky.addColorStop(0, '#172851');
    sky.addColorStop(0.55, '#36568d');
    sky.addColorStop(1, '#f0a670');
    this.context.fillStyle = sky;
    this.context.fillRect(0, 0, camera.viewport.x, camera.viewport.y);
  }

  private drawTerrain(terrain: TerrainSnapshot): void {
    if (this.terrainCanvas === null) {
      this.paintTerrain(this.context, terrain);
      return;
    }
    if (this.retainedTerrain !== terrain) {
      this.retainedTerrain = terrain;
      this.terrainCanvas.width = terrain.width;
      this.terrainCanvas.height = terrain.height;
      const retained = this.terrainCanvas.getContext('2d');
      if (retained === null) throw new Error('Retained terrain canvas is unavailable');
      this.paintTerrain(retained, terrain);
    }
    this.context.drawImage(this.terrainCanvas, 0, 0);
  }

  private paintTerrain(context: CanvasRenderingContext2D, terrain: TerrainSnapshot): void {
    context.fillStyle = '#3d623e';
    for (let y = 0; y < terrain.height; y += 1) {
      let start = -1;
      for (let x = 0; x <= terrain.width; x += 1) {
        const solid = x < terrain.width && terrain.bytes[y * terrain.width + x] !== 0;
        if (solid && start === -1) start = x;
        if (!solid && start !== -1) {
          context.fillRect(start, y, x - start, 1);
          start = -1;
        }
      }
    }
  }

  private drawAlien(alien: AlienState, active: boolean): void {
    const context = this.context;
    const palette = alien.team === 'human' ? HUMAN_PALETTE : CPU_PALETTE;
    const { x, y } = alien.position;

    context.save();
    context.translate(x, y);
    if (alien.health <= 0) {
      context.fillStyle = '#27324b';
      context.beginPath();
      context.ellipse(0, 6, GAME_CONFIG.alienRadius, 9, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#f4f6ff';
      context.font = 'bold 10px system-ui';
      context.textAlign = 'center';
      context.fillText('DEFEATED', 0, -10);
      context.restore();
      return;
    }
    context.strokeStyle = palette.antenna;
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(-6, -15);
    context.quadraticCurveTo(-12, -29, -18, -24);
    context.moveTo(6, -15);
    context.quadraticCurveTo(12, -29, 18, -24);
    context.stroke();
    context.fillStyle = palette.antenna;
    context.beginPath();
    context.arc(-18, -24, 3, 0, Math.PI * 2);
    context.arc(18, -24, 3, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = palette.shade;
    context.beginPath();
    context.ellipse(0, 2, GAME_CONFIG.alienRadius, GAME_CONFIG.alienRadius * 0.88, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = palette.body;
    context.beginPath();
    context.ellipse(0, -2, GAME_CONFIG.alienRadius - 2, GAME_CONFIG.alienRadius * 0.72, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = palette.visor;
    context.beginPath();
    context.roundRect(-11, -9, 22, 10, 5);
    context.fill();
    context.fillStyle = '#1c2445';
    context.beginPath();
    context.arc(-4, -4, 2, 0, Math.PI * 2);
    context.arc(4, -4, 2, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = '#1c2445';
    context.fillRect(-16, -31, 32, 5);
    context.fillStyle = alien.health > 50 ? '#80e49b' : alien.health > 20 ? '#ffd36e' : '#fa7373';
    context.fillRect(-15, -30, Math.max(0, Math.min(30, alien.health * 0.3)), 3);
    if (active) {
      context.fillStyle = '#fff5a8';
      context.font = 'bold 10px system-ui';
      context.textAlign = 'center';
      context.fillText('ACTIVE', 0, -38);
    }
    context.restore();
  }

  private drawProjectile(position: Vec2, weapon: MatchState['selectedWeapon']): void {
    const context = this.context;
    context.save();
    context.translate(position.x, position.y);
    context.fillStyle = weapon === 'grenade' ? '#6ca54d' : '#f4d16d';
    if (weapon === 'grenade') {
      context.beginPath();
      context.arc(0, 0, 7, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#d7f29b';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(3, -7, 5, Math.PI, 0);
      context.stroke();
    } else {
      context.rotate(-0.4);
      context.fillRect(-10, -3, 20, 6);
      context.fillStyle = '#ef735a';
      context.beginPath();
      context.moveTo(10, -5);
      context.lineTo(16, 0);
      context.lineTo(10, 5);
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  private drawEvent(event: GameEvent, match: MatchState): void {
    const context = this.context;
    if (event.type === 'shot') {
      const muzzle = {
        x: event.position.x + Math.cos(event.aimRadians) * (GAME_CONFIG.alienRadius + 4),
        y: event.position.y + Math.sin(event.aimRadians) * (GAME_CONFIG.alienRadius + 4),
      };
      context.fillStyle = '#fff1a6';
      context.beginPath();
      context.arc(muzzle.x, muzzle.y, 8, 0, Math.PI * 2);
      context.fill();
      return;
    }
    if (event.type === 'explosion') {
      context.strokeStyle = '#fff1a6';
      context.lineWidth = 4;
      context.beginPath();
      context.arc(event.position.x, event.position.y, event.radius, 0, Math.PI * 2);
      context.stroke();
      return;
    }

    const alien = match.aliens.find(candidate => candidate.id === event.alienId);
    if (alien === undefined) return;
    if (event.type === 'damage') {
      context.fillStyle = '#fff2d0';
      context.font = 'bold 16px system-ui';
      context.fillText(`-${Math.round(event.amount)}`, alien.position.x - 12, alien.position.y - 42);
      return;
    }

    context.strokeStyle = '#f4f6ff';
    context.lineWidth = 3;
    context.beginPath();
    context.arc(alien.position.x, alien.position.y, GAME_CONFIG.alienRadius + 8, 0, Math.PI * 2);
    context.stroke();
  }

  private drawTrajectoryPreview(match: MatchState): void {
    if (match.projectile !== null || (match.phase !== 'ready' && match.phase !== 'aiming')) return;
    const activeAlien = match.aliens.filter(alien => alien.team === match.activeTeam)[match.activeAlienIndex[match.activeTeam]];
    if (activeAlien === undefined) return;

    const speed = (GAME_CONFIG.bazookaMinSpeedPixelsPerSecond + GAME_CONFIG.bazookaMaxSpeedPixelsPerSecond) / 2;
    let position = { ...activeAlien.position };
    let velocity = {
      x: Math.cos(activeAlien.aimRadians) * speed,
      y: Math.sin(activeAlien.aimRadians) * speed,
    };
    const context = this.context;
    context.fillStyle = '#fff5b8';
    for (let index = 0; index < 18; index += 1) {
      velocity = { x: velocity.x + match.wind * 0.08, y: velocity.y + GAME_CONFIG.gravityPixelsPerSecondSquared * 0.08 };
      position = { x: position.x + velocity.x * 0.08, y: position.y + velocity.y * 0.08 };
      context.beginPath();
      context.arc(position.x, position.y, 2, 0, Math.PI * 2);
      context.fill();
    }
  }

  private drawHud(match: MatchState, camera: Camera): void {
    const context = this.context;
    const safe = this.safeArea();
    context.fillStyle = '#101a36c9';
    context.fillRect(safe.left + 12, safe.top + 12, 224, 48);
    context.fillStyle = '#fff5d6';
    context.font = '600 14px system-ui';
    context.fillText(`${match.activeTeam === 'human' ? 'Ваш ход' : 'Ход соперника'} · ${Math.ceil(match.humanTurnSecondsRemaining)}с`, safe.left + 24, safe.top + 33);
    context.fillStyle = '#bcd4ff';
    context.font = '12px system-ui';
    context.fillText(`Ветер ${Math.round(match.wind)} · ${match.selectedWeapon === 'bazooka' ? 'Базука' : 'Граната'}`, safe.left + 24, safe.top + 51);
    context.strokeStyle = '#ffffff33';
    context.strokeRect(safe.left + 12, safe.top + 12, 224, 48);
    this.drawRoster(match, camera);
    void camera;
  }

  private drawRoster(match: MatchState, camera: Camera): void {
    const context = this.context;
    const safe = this.safeArea();
    const members = [
      ...match.aliens.filter(alien => alien.team === 'human'),
      ...match.aliens.filter(alien => alien.team === 'cpu'),
    ];
    const active = match.aliens.filter(alien => alien.team === match.activeTeam)[match.activeAlienIndex[match.activeTeam]];
    const cells = rosterLayout(camera.viewport, safe);
    members.forEach((alien, index) => {
      this.drawRosterPortrait(alien, cells[index], active?.id === alien.id);
    });
  }

  private drawRosterPortrait(alien: AlienState, cell: RosterPortraitCell, active: boolean): void {
    const context = this.context;
    const palette = alien.team === 'human' ? HUMAN_PALETTE : CPU_PALETTE;
    const centerX = cell.x + cell.size / 2;
    const centerY = cell.y + cell.size / 2 - 2;
    const variant = Number(alien.id.at(-1)) || 0;

    context.save();
    context.fillStyle = alien.health <= 0 ? '#3b4357e6' : '#111d3ee6';
    context.beginPath();
    context.roundRect(cell.x, cell.y, cell.size, cell.size, 10);
    context.fill();
    context.strokeStyle = active ? '#fff5a8' : '#ffffff55';
    context.lineWidth = active ? 2.5 : 1;
    context.stroke();

    context.strokeStyle = alien.health <= 0 ? '#8c95a8' : palette.antenna;
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(centerX - 6, centerY - 9);
    context.quadraticCurveTo(centerX - 13 - variant * 2, centerY - 23, centerX - 17, centerY - 18 + variant);
    context.moveTo(centerX + 6, centerY - 9);
    context.quadraticCurveTo(centerX + 13 + variant * 2, centerY - 23, centerX + 17, centerY - 18 - variant);
    context.stroke();

    context.fillStyle = alien.health <= 0 ? '#778095' : palette.body;
    context.beginPath();
    context.arc(centerX, centerY, 12, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = alien.health <= 0 ? '#d6d9e2' : palette.visor;
    context.beginPath();
    context.roundRect(centerX - 10, centerY - 4, 20, 9, 5);
    context.fill();
    context.fillStyle = '#1c2445';
    context.beginPath();
    context.arc(centerX - 4 - variant, centerY, 1.8, 0, Math.PI * 2);
    context.arc(centerX + 4 + variant, centerY, 1.8, 0, Math.PI * 2);
    if (variant === 2) context.arc(centerX, centerY + 3, 1.5, 0, Math.PI * 2);
    context.fill();

    if (alien.health <= 0) {
      context.strokeStyle = '#f4f6ff';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(centerX - 9, centerY - 9);
      context.lineTo(centerX + 9, centerY + 9);
      context.stroke();
    }

    context.fillStyle = '#1c2445';
    context.fillRect(cell.x + 6, cell.y + cell.size - 8, cell.size - 12, 4);
    context.fillStyle = alien.health > 50 ? '#80e49b' : alien.health > 20 ? '#ffd36e' : '#fa7373';
    context.fillRect(cell.x + 6, cell.y + cell.size - 8, (cell.size - 12) * Math.max(0, Math.min(100, alien.health)) / 100, 4);
    context.fillStyle = '#ffffff';
    context.font = 'bold 9px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    if (active || alien.health <= 0) {
      context.fillText(active ? 'ACTIVE' : 'DEFEATED', centerX, cell.y + 8);
    }
    context.fillText(`${Math.ceil(alien.health)}`, centerX, cell.y + cell.size - 14);
    context.restore();
  }

  private drawWinner(match: MatchState, camera: Camera): void {
    const context = this.context;
    const label = match.winner === 'human' ? 'HUMAN WINS' : match.winner === 'cpu' ? 'CPU WINS' : 'DRAW';
    context.fillStyle = '#0d1220dd';
    context.fillRect(0, 0, camera.viewport.x, camera.viewport.y);
    context.fillStyle = '#fff5d6';
    context.font = 'bold 34px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, camera.viewport.x / 2, camera.viewport.y / 2);
    context.textAlign = 'start';
    context.textBaseline = 'alphabetic';
  }

  private updateEffects(events: readonly GameEvent[]): void {
    const now = this.options.nowMilliseconds?.() ?? performance.now();
    this.effects = this.effects.filter(effect => effect.expiresAt > now);
    if (events === this.lastEvents) return;
    this.lastEvents = events;
    for (const event of events) {
      const duration = event.type === 'shot' ? 250
        : event.type === 'explosion' ? 700
          : event.type === 'damage' ? 900 : 1_200;
      this.effects.push({ event, expiresAt: now + duration });
    }
  }

  private drawTouchControls(camera: Camera): void {
    const context = this.context;
    const layout = controlLayout({ width: camera.viewport.x, height: camera.viewport.y, safeArea: this.safeArea() });
    if (layout === null) return;

    context.save();
    context.fillStyle = '#0d1532a8';
    context.strokeStyle = '#d8e7ff66';
    context.lineWidth = 1.5;
    layout.buttons.forEach(button => this.button(button.rect, labelFor(button.id)));
    context.restore();
  }

  private button(rect: { x: number; y: number; width: number; height: number }, label: string): void {
    const context = this.context;
    context.fillStyle = '#0d1532a8';
    context.beginPath();
    context.roundRect(rect.x, rect.y, Math.max(0, rect.width), rect.height, 8);
    context.fill();
    context.stroke();
    context.fillStyle = '#eff6ff';
    context.font = '600 12px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, rect.x + rect.width / 2, rect.y + rect.height / 2);
    context.textAlign = 'start';
    context.textBaseline = 'alphabetic';
  }

  private drawRotateOverlay(camera: Camera): void {
    const context = this.context;
    context.fillStyle = '#0d1220';
    context.fillRect(0, 0, camera.viewport.x, camera.viewport.y);
    context.fillStyle = '#f7f0df';
    context.font = '600 22px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('Поверните iPhone', camera.viewport.x / 2, camera.viewport.y / 2);
    context.textAlign = 'start';
    context.textBaseline = 'alphabetic';
  }

  private safeArea(): SafeAreaInsets {
    const safe = this.options.getSafeArea?.();
    return {
      top: safe?.top ?? 0,
      right: safe?.right ?? 0,
      bottom: safe?.bottom ?? 0,
      left: safe?.left ?? 0,
    };
  }
}

function labelFor(control: ControlId): string {
  switch (control) {
    case 'move-left': return '←';
    case 'jump': return '↑';
    case 'move-right': return '→';
    case 'bazooka': return 'Базука';
    case 'grenade': return 'Граната';
    case 'aim': return 'Прицел';
    case 'fire': return 'Огонь';
  }
}
