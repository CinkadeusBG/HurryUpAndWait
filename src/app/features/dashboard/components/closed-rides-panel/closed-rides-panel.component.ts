import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AccordionModule } from 'primeng/accordion';
import { AttractionViewModel } from '../../../../core/models/theme-parks.models';
import { AttractionCardComponent } from '../attraction-card/attraction-card.component';

@Component({
  selector: 'app-closed-rides-panel',
  standalone: true,
  imports: [AccordionModule, AttractionCardComponent],
  templateUrl: './closed-rides-panel.component.html',
  styleUrl: './closed-rides-panel.component.scss',
})
export class ClosedRidesPanelComponent {
  @Input({ required: true }) closedAttractions: AttractionViewModel[] = [];
  @Input() showParkName = false;
  @Input() parkTimezone = 'America/New_York';
  @Output() favoriteToggle = new EventEmitter<string>();
}