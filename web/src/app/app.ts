import { Component } from '@angular/core';
import { Chat } from './components/chat/chat';
import { Sidebar } from './components/sidebar/sidebar';

@Component({
  selector: 'app-root',
  imports: [Sidebar, Chat],
  templateUrl: './app.html',
})
export class App {}
