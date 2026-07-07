import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-park-icon',
  standalone: true,
  template: `<span class="park-emoji" aria-hidden="true">{{ emoji }}</span>`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }

    .park-emoji {
      font-size: 1.05rem;
      font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
    }
  `,
})
export class ParkIconComponent {
  @Input({ required: true }) emoji!: string;
}