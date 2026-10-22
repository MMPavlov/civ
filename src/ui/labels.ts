import type { CloudClass, DecisionKind, EventType, RelationStatus } from '../sim/types';

export const CLASS_NAMES: Record<CloudClass, string> = { small: 'малое', medium: 'среднее', large: 'большое' };

export const STATUS_NAMES: Record<RelationStatus, string> = {
  contact: 'контакт',
  coexist: 'сосуществование',
  trade: 'торговля',
  alliance: 'союз',
  patronage: 'покровительство',
  war: 'конфликт',
};

export const EVENT_NAMES: Record<EventType, string> = {
  contact: 'Контакт',
  trade: 'Торговля',
  alliance: 'Союз',
  patronage: 'Покровительство',
  integration_start: 'Начало интеграции',
  integration: 'Интеграция',
  integration_refused: 'Отказ от интеграции',
  hybrid: 'Гибридная культура',
  assimilation: 'Ассимиляция',
  settlement: 'Новое поселение',
  settlement_up: 'Рост поселения',
  settlement_down: 'Упадок поселения',
  settlement_abandoned: 'Исчезновение поселения',
  state: 'Государство',
  state_collapse: 'Распад государства',
  conflict: 'Конфликт',
  peace: 'Мир',
  schism: 'Раскол',
  treaty: 'Территориальное соглашение',
  treaty_broken: 'Пересмотр договора',
  negotiation: 'Переговоры',
  dispute: 'Территориальный спор',
  famine: 'Голод',
  extinction: 'Исчезновение облака',
  stabilized: 'Стабилизация',
};

export const DECISION_NAMES: Record<DecisionKind, string> = {
  strategy: 'Стратегия',
  migration: 'Миграция',
  diplomacy: 'Дипломатия',
  integration: 'Интеграция',
  war: 'Конфликт',
  settlement: 'Основание поселения',
  settlement_upgrade: 'Рост / упадок поселения',
  state: 'Государство',
  negotiation: 'Переговоры',
  schism: 'Раскол',
  border: 'Граница',
};

export function num(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function pct(v: number, digits = 0): string {
  return `${num(v * 100, digits)}%`;
}
