import { useState } from 'react';
import { AppsPage } from './AppsPage.js';
import { AuditTrailPage } from './AuditTrailPage.js';
import { DeliveryLogPage } from './DeliveryLogPage.js';
import { SubscriptionsPage } from './SubscriptionsPage.js';

type Tab = 'apps' | 'subscriptions' | 'deliveries' | 'audit';

export function DeveloperPortal() {
  const [tab, setTab] = useState<Tab>('apps');

  return (
    <div>
      <nav style={{ display: 'flex', gap: 8, padding: '8px 24px', borderBottom: '1px solid #eee' }}>
        <strong>Developer Portal</strong>
        <button onClick={() => setTab('apps')} style={{ fontWeight: tab === 'apps' ? 'bold' : 'normal' }}>Apps</button>
        <button onClick={() => setTab('subscriptions')} style={{ fontWeight: tab === 'subscriptions' ? 'bold' : 'normal' }}>Subscriptions</button>
        <button onClick={() => setTab('deliveries')} style={{ fontWeight: tab === 'deliveries' ? 'bold' : 'normal' }}>Delivery Log</button>
        <button onClick={() => setTab('audit')} style={{ fontWeight: tab === 'audit' ? 'bold' : 'normal' }}>Audit Trail</button>
      </nav>
      {tab === 'apps' && <AppsPage />}
      {tab === 'subscriptions' && <SubscriptionsPage />}
      {tab === 'deliveries' && <DeliveryLogPage />}
      {tab === 'audit' && <AuditTrailPage />}
    </div>
  );
}
