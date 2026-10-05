import {
  CONTROL_RANGES,
  PRESETS,
  TIMING,
  type Controls as ControlValues,
  type PresetId,
} from '../config/presets';
import type { QualitySetting, Settings } from '../platform/settings';

export interface ControlHandlers {
  onPreset(id: PresetId): void;
  onControl(key: keyof ControlValues, value: number): void;
  onQuality(q: QualitySetting): void;
  onPause(): void;
  onNext(): void;
  onFullscreen(): void;
  onRandomize(): void;
  onToggleMatrix(on: boolean): void;
  onToggleParticles(on: boolean): void;
  // Screensaver configuration window only
  onDisplays?(v: Settings['displays']): void;
  onUseAsScreensaver?(): void;
  onOpenScreensaverSettings?(): void;
  onResetDefaults?(): void;
  onClose?(): void;
}

export interface ControlStatus {
  paused: boolean;
  fieldName: string;
  seed: number;
  fps: number;
  quality: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

const fmt = (v: number) => v.toFixed(2);

/**
 * Minimal control panel. Invisible in normal playback; mouse movement
 * reveals it and it fades away after ~3 s without activity. In the
 * screensaver configuration window it stays visible.
 */
export class ControlsPanel {
  readonly root: HTMLDivElement;
  private presetButtons = new Map<PresetId, HTMLButtonElement>();
  private sliders = new Map<keyof ControlValues, { input: HTMLInputElement; out: HTMLSpanElement }>();
  private qualitySelect!: HTMLSelectElement;
  private matrixToggle!: HTMLInputElement;
  private particlesToggle!: HTMLInputElement;
  private displaysSelect?: HTMLSelectElement;
  private pauseButton!: HTMLButtonElement;
  private status!: HTMLDivElement;
  private message!: HTMLDivElement;
  private hideTimer: number | undefined;
  private cursorTimer: number | undefined;
  private hovering = false;
  private dragging = false;

  constructor(
    host: HTMLElement,
    private readonly handlers: ControlHandlers,
    private readonly opts: { configMode: boolean },
  ) {
    this.root = el('div', { class: `ui ${opts.configMode ? 'config visible' : ''}`, 'aria-label': 'Field controls' });
    this.root.append(this.build());
    host.append(this.root);

    this.root.addEventListener('pointerenter', () => (this.hovering = true));
    this.root.addEventListener('pointerleave', () => {
      this.hovering = false;
      this.poke();
    });
    window.addEventListener('pointerup', () => {
      this.dragging = false;
      this.poke();
    });

    if (!opts.configMode) {
      window.addEventListener('mousemove', () => this.poke(), { passive: true });
      window.addEventListener('pointerdown', () => this.poke(), { passive: true });
    }
    this.armCursorHide();
    window.addEventListener('mousemove', () => this.armCursorHide(), { passive: true });
  }

  private build(): HTMLElement {
    const h = this.handlers;
    const panel = el('div', { class: 'panel' });

    panel.append(
      el(
        'header',
        {},
        el('div', { class: 'title' }, 'Soundwavian Field'),
        el('div', { class: 'subtitle' }, '// Galactic Mandala'),
      ),
    );

    const presets = el('div', { class: 'presets', role: 'group', 'aria-label': 'Presets' });
    PRESETS.forEach((p, i) => {
      const b = el('button', { type: 'button', title: `${p.description}  [${i + 1}]` }, p.label);
      b.addEventListener('click', () => {
        h.onPreset(p.id);
        b.blur();
      });
      this.presetButtons.set(p.id, b);
      presets.append(b);
    });
    panel.append(presets);

    const sliders = el('div', { class: 'sliders' });
    for (const key of Object.keys(CONTROL_RANGES) as (keyof ControlValues)[]) {
      const range = CONTROL_RANGES[key];
      const input = el('input', {
        type: 'range',
        min: String(range.min),
        max: String(range.max),
        step: '0.01',
        'aria-label': range.label,
      });
      const out = el('span', { class: 'value' });
      input.addEventListener('pointerdown', () => (this.dragging = true));
      input.addEventListener('input', () => {
        const v = Number(input.value);
        out.textContent = fmt(v);
        h.onControl(key, v);
      });
      input.addEventListener('change', () => input.blur());
      sliders.append(el('label', { class: 'slider' }, el('span', { class: 'name' }, range.label), input, out));
      this.sliders.set(key, { input, out });
    }
    panel.append(sliders);

    const actions = el('div', { class: 'actions' });
    const button = (label: string, hint: string, fn: () => void) => {
      const b = el('button', { type: 'button', title: hint }, label);
      b.addEventListener('click', () => {
        fn();
        b.blur();
      });
      actions.append(b);
      return b;
    };
    this.pauseButton = button('Pause', 'Pause / resume  [Space]', () => h.onPause());
    button('Next Field', 'Begin the next transition  [→]', () => h.onNext());
    if (!this.opts.configMode) button('Fullscreen', 'Toggle fullscreen  [F]', () => h.onFullscreen());
    button('Randomize Seed', 'New particle, geometry and timing seed  [R]', () => h.onRandomize());
    panel.append(actions);

    const options = el('div', { class: 'options' });
    this.qualitySelect = el('select', { 'aria-label': 'Quality' });
    for (const [v, label] of [
      ['auto', 'Auto'],
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High'],
      ['ultra', 'Ultra'],
    ]) {
      this.qualitySelect.append(el('option', { value: v }, label));
    }
    this.qualitySelect.addEventListener('change', () => {
      h.onQuality(this.qualitySelect.value as QualitySetting);
      this.qualitySelect.blur();
    });
    options.append(el('label', { class: 'option' }, el('span', { class: 'name' }, 'Quality'), this.qualitySelect));

    this.matrixToggle = el('input', { type: 'checkbox', 'aria-label': 'Matrix layer' });
    this.matrixToggle.addEventListener('change', () => {
      h.onToggleMatrix(this.matrixToggle.checked);
      this.matrixToggle.blur();
    });
    this.particlesToggle = el('input', { type: 'checkbox', 'aria-label': 'Particles' });
    this.particlesToggle.addEventListener('change', () => {
      h.onToggleParticles(this.particlesToggle.checked);
      this.particlesToggle.blur();
    });
    options.append(
      el('label', { class: 'check', title: '[M]' }, this.matrixToggle, 'Matrix'),
      el('label', { class: 'check', title: '[P]' }, this.particlesToggle, 'Particles'),
    );
    panel.append(options);

    if (this.opts.configMode) panel.append(this.buildWindowsSection());

    this.message = el('div', { class: 'message', role: 'status' });
    this.status = el('div', { class: 'status' });
    panel.append(this.message, this.status);
    return panel;
  }

  private buildWindowsSection(): HTMLElement {
    const h = this.handlers;
    const section = el('section', { class: 'windows' });
    section.append(el('div', { class: 'section-title' }, 'Windows screen saver'));

    this.displaysSelect = el('select', { 'aria-label': 'Displays' });
    this.displaysSelect.append(
      el('option', { value: 'all' }, 'Every display'),
      el('option', { value: 'primary' }, 'Primary display only'),
    );
    this.displaysSelect.addEventListener('change', () =>
      h.onDisplays?.(this.displaysSelect!.value as Settings['displays']),
    );
    section.append(el('label', { class: 'option' }, el('span', { class: 'name' }, 'Show on'), this.displaysSelect));

    const row = el('div', { class: 'actions' });
    const add = (label: string, hint: string, fn?: () => void) => {
      if (!fn) return;
      const b = el('button', { type: 'button', title: hint }, label);
      b.addEventListener('click', fn);
      row.append(b);
    };
    add('Use as my screen saver', 'Sets Soundwavian Field as your screen saver (current Windows user only)', h.onUseAsScreensaver);
    add('Screen Saver Settings…', 'Open the Windows Screen Saver Settings dialog', h.onOpenScreensaverSettings);
    add('Reset to defaults', 'Restore the default preset and controls', h.onResetDefaults);
    add('Done', 'Save and close', h.onClose);
    section.append(row);
    section.append(
      el(
        'p',
        { class: 'note' },
        'Settings are saved for your Windows user account only. Soundwavian Field works fully offline and never connects to the internet.',
      ),
    );
    return section;
  }

  /** Reflect settings into the widgets (no handler callbacks fire). */
  sync(s: Settings) {
    for (const [id, b] of this.presetButtons) b.classList.toggle('active', id === s.preset);
    for (const [key, { input, out }] of this.sliders) {
      input.value = String(s.controls[key]);
      out.textContent = fmt(s.controls[key]);
    }
    this.qualitySelect.value = s.quality;
    this.matrixToggle.checked = s.matrix;
    this.particlesToggle.checked = s.particles;
    if (this.displaysSelect) this.displaysSelect.value = s.displays;
  }

  setStatus(st: ControlStatus) {
    this.pauseButton.textContent = st.paused ? 'Resume' : 'Pause';
    this.status.textContent = `${st.fieldName} · seed ${st.seed} · ${st.quality} · ${Math.round(st.fps)} fps`;
  }

  flash(text: string) {
    this.message.textContent = text;
    this.message.classList.add('show');
    window.setTimeout(() => this.message.classList.remove('show'), 4000);
    this.poke();
  }

  /** Reveal and (re)arm the auto-hide timer. */
  poke() {
    if (this.opts.configMode) return;
    this.root.classList.add('visible');
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (this.hovering || this.dragging) return this.poke();
      this.root.classList.remove('visible');
    }, TIMING.uiHideAfterMs);
  }

  private armCursorHide() {
    document.body.classList.remove('idle');
    window.clearTimeout(this.cursorTimer);
    this.cursorTimer = window.setTimeout(() => {
      if (!this.hovering) document.body.classList.add('idle');
    }, TIMING.cursorHideAfterMs);
  }
}
