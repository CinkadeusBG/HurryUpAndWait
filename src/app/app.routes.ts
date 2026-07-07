import { Routes } from '@angular/router';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { RideDetailComponent } from './features/ride-detail/ride-detail.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'ride/:parkId/:attractionId', component: RideDetailComponent },
  { path: '**', redirectTo: '' },
];