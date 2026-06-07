import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient, queryPersister } from '@/lib/queryClient';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { RealtimeEventsProvider } from '@/hooks/useRealtimeEvents';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { DocumentsProvider } from '@/contexts/DocumentsContext';
import { ProgramsProvider } from '@/contexts/ProgramsContext';
import { IssuesProvider } from '@/contexts/IssuesContext';
import { ProjectsProvider } from '@/contexts/ProjectsContext';
import { ArchivedPersonsProvider } from '@/contexts/ArchivedPersonsContext';
import { CurrentDocumentProvider } from '@/contexts/CurrentDocumentContext';
import { UploadProvider } from '@/contexts/UploadContext';
import { LoginPage } from '@/pages/Login';
import { SdkPage } from '@/pages/SdkPage';
import { AppLayout } from '@/pages/App';
import { ReviewQueueProvider } from '@/contexts/ReviewQueueContext';
import { InviteAcceptPage } from '@/pages/InviteAccept';
import { SetupPage } from '@/pages/Setup';

// Heavy pages lazy-loaded to keep initial bundle small
const DocumentsPage = lazy(() => import('@/pages/Documents').then(m => ({ default: m.DocumentsPage })));
const IssuesPage = lazy(() => import('@/pages/Issues').then(m => ({ default: m.IssuesPage })));
const ProgramsPage = lazy(() => import('@/pages/Programs').then(m => ({ default: m.ProgramsPage })));
const TeamModePage = lazy(() => import('@/pages/TeamMode').then(m => ({ default: m.TeamModePage })));
const TeamDirectoryPage = lazy(() => import('@/pages/TeamDirectory').then(m => ({ default: m.TeamDirectoryPage })));
const PersonEditorPage = lazy(() => import('@/pages/PersonEditor').then(m => ({ default: m.PersonEditorPage })));
const FeedbackEditorPage = lazy(() => import('@/pages/FeedbackEditor').then(m => ({ default: m.FeedbackEditorPage })));
const PublicFeedbackPage = lazy(() => import('@/pages/PublicFeedback').then(m => ({ default: m.PublicFeedbackPage })));
const ProjectsPage = lazy(() => import('@/pages/Projects').then(m => ({ default: m.ProjectsPage })));
const DashboardPage = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.DashboardPage })));
const MyWeekPage = lazy(() => import('@/pages/MyWeekPage').then(m => ({ default: m.MyWeekPage })));
const AdminDashboardPage = lazy(() => import('@/pages/AdminDashboard').then(m => ({ default: m.AdminDashboardPage })));
const AdminWorkspaceDetailPage = lazy(() => import('@/pages/AdminWorkspaceDetail').then(m => ({ default: m.AdminWorkspaceDetailPage })));
const WorkspaceSettingsPage = lazy(() => import('@/pages/WorkspaceSettings').then(m => ({ default: m.WorkspaceSettingsPage })));
const ConvertedDocumentsPage = lazy(() => import('@/pages/ConvertedDocuments').then(m => ({ default: m.ConvertedDocumentsPage })));
const DeveloperPortal = lazy(() => import('@/pages/developer/index.js').then(m => ({ default: m.DeveloperPortal })));
const UnifiedDocumentPage = lazy(() => import('@/pages/UnifiedDocumentPage').then(m => ({ default: m.UnifiedDocumentPage })));
const StatusOverviewPage = lazy(() => import('@/pages/StatusOverviewPage').then(m => ({ default: m.StatusOverviewPage })));
const ReviewsPage = lazy(() => import('@/pages/ReviewsPage').then(m => ({ default: m.ReviewsPage })));
const OrgChartPage = lazy(() => import('@/pages/OrgChartPage').then(m => ({ default: m.OrgChartPage })));
import { ToastProvider } from '@/components/ui/Toast';
import { MutationErrorToast } from '@/components/MutationErrorToast';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import './index.css';

const CHUNK_RELOAD_KEY = 'ship:chunk-reload-attempted';
const STYLESHEET_RELOAD_KEY = 'ship:stylesheet-reload-attempted';

function isChunkLoadError(reason: unknown): boolean {
  if (!reason) return false;
  const text = reason instanceof Error ? reason.message : String(reason);
  return text.includes('Failed to fetch dynamically imported module');
}

function installChunkReloadRecovery(): void {
  const reloadOnce = () => {
    try {
      if (sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1') return;
      sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    } catch {
      // If sessionStorage is unavailable, still attempt a single reload for this runtime.
    }
    window.location.reload();
  };

  window.addEventListener('error', (event) => {
    if (isChunkLoadError(event.error)) reloadOnce();
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason)) reloadOnce();
  });

  window.addEventListener('pageshow', () => {
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch {
      // ignore
    }
  });
}

installChunkReloadRecovery();

function installStylesheetReloadRecovery(): void {
  const reloadOnce = () => {
    try {
      if (sessionStorage.getItem(STYLESHEET_RELOAD_KEY) === '1') return;
      sessionStorage.setItem(STYLESHEET_RELOAD_KEY, '1');
    } catch {
      // If sessionStorage is unavailable, still attempt one reload for this runtime.
    }
    window.location.reload();
  };

  document.addEventListener(
    'error',
    (event) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (
        target.tagName === 'LINK' &&
        target.getAttribute('rel') === 'stylesheet' &&
        (target as HTMLLinkElement).href.includes('/assets/')
      ) {
        reloadOnce();
      }
    },
    true
  );

  window.addEventListener('pageshow', () => {
    try {
      sessionStorage.removeItem(STYLESHEET_RELOAD_KEY);
    } catch {
      // ignore
    }
  });
}

installStylesheetReloadRecovery();

function EB({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

/**
 * Redirect component for type-specific routes to canonical /documents/:id
 * Uses replace to ensure browser history only has one entry
 */
function DocumentRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/documents/${id}`} replace />;
}

/**
 * Redirect component for /programs/:id/* routes to /documents/:id/*
 * Preserves the tab portion of the path (issues, projects, sprints)
 */
function ProgramTabRedirect() {
  const { id, '*': splat } = useParams<{ id: string; '*': string }>();
  const tab = splat || '';
  const targetPath = tab ? `/documents/${id}/${tab}` : `/documents/${id}`;
  return <Navigate to={targetPath} replace />;
}

/**
 * Redirect component for /sprints/:id/* routes to /documents/:id/*
 * Maps old sprint sub-routes to new unified document tab routes
 */
function SprintTabRedirect({ tab }: { tab?: string }) {
  const { id } = useParams<{ id: string }>();
  // Map 'planning' to 'plan' for consistency
  const mappedTab = tab === 'planning' ? 'plan' : tab;
  // 'view' maps to root (overview tab)
  const targetPath = mappedTab && mappedTab !== 'view'
    ? `/documents/${id}/${mappedTab}`
    : `/documents/${id}`;
  return <Navigate to={targetPath} replace />;
}

function PlaceholderPage({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <h1 className="text-xl font-medium text-foreground">{title}</h1>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
    </div>
  );
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/docs" replace />;
  }

  return <>{children}</>;
}

function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isSuperAdmin } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isSuperAdmin) {
    return <Navigate to="/docs" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      {/* Truly public routes - no AuthProvider wrapper */}
      <Route path="/sdk" element={<SdkPage />} />
      <Route
        path="/feedback/:programId"
        element={<Suspense fallback={null}><PublicFeedbackPage /></Suspense>}
      />
      {/* Routes that need AuthProvider (even if some are public) */}
      <Route
        path="/*"
        element={
          <WorkspaceProvider>
            <AuthProvider>
              <RealtimeEventsProvider>
                <AppRoutes />
              </RealtimeEventsProvider>
            </AuthProvider>
          </WorkspaceProvider>
        }
      />
    </Routes>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-background"><div className="text-muted">Loading...</div></div>}>
    <Routes>
      <Route
        path="/setup"
        element={<SetupPage />}
      />
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/invite/:token"
        element={<InviteAcceptPage />}
      />
      <Route
        path="/admin"
        element={
          <SuperAdminRoute>
            <EB><AdminDashboardPage /></EB>
          </SuperAdminRoute>
        }
      />
      <Route
        path="/admin/workspaces/:id"
        element={
          <SuperAdminRoute>
            <EB><AdminWorkspaceDetailPage /></EB>
          </SuperAdminRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <CurrentDocumentProvider>
              <ArchivedPersonsProvider>
                <DocumentsProvider>
                  <ProgramsProvider>
                    <ProjectsProvider>
                      <IssuesProvider>
                        <UploadProvider>
                          <AppLayout />
                        </UploadProvider>
                      </IssuesProvider>
                    </ProjectsProvider>
                  </ProgramsProvider>
                </DocumentsProvider>
              </ArchivedPersonsProvider>
            </CurrentDocumentProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/my-week" replace />} />
        <Route path="dashboard" element={<EB><DashboardPage /></EB>} />
        <Route path="my-week" element={<EB><MyWeekPage /></EB>} />
        <Route path="docs" element={<EB><DocumentsPage /></EB>} />
        <Route path="docs/:id" element={<DocumentRedirect />} />
        <Route path="documents/:id/*" element={<EB><UnifiedDocumentPage /></EB>} />
        <Route path="issues" element={<EB><IssuesPage /></EB>} />
        <Route path="issues/:id" element={<DocumentRedirect />} />
        <Route path="projects" element={<EB><ProjectsPage /></EB>} />
        <Route path="projects/:id" element={<DocumentRedirect />} />
        <Route path="programs" element={<EB><ProgramsPage /></EB>} />
        <Route path="programs/:programId/sprints/:id" element={<DocumentRedirect />} />
        <Route path="programs/:id/*" element={<ProgramTabRedirect />} />
        <Route path="sprints" element={<Navigate to="/team/allocation" replace />} />
        {/* Sprint routes - redirect legacy views to /documents/:id, keep planning workflow */}
        <Route path="sprints/:id" element={<DocumentRedirect />} />
        <Route path="sprints/:id/view" element={<SprintTabRedirect tab="view" />} />
        <Route path="sprints/:id/plan" element={<SprintTabRedirect tab="plan" />} />
        <Route path="sprints/:id/planning" element={<SprintTabRedirect tab="planning" />} />
        <Route path="sprints/:id/standups" element={<SprintTabRedirect tab="standups" />} />
        <Route path="sprints/:id/review" element={<SprintTabRedirect tab="review" />} />
        <Route path="team" element={<Navigate to="/team/allocation" replace />} />
        <Route path="team/allocation" element={<EB><TeamModePage /></EB>} />
        <Route path="team/directory" element={<EB><TeamDirectoryPage /></EB>} />
        <Route path="team/status" element={<EB><StatusOverviewPage /></EB>} />
        <Route path="team/reviews" element={<EB><ReviewsPage /></EB>} />
        <Route path="team/org-chart" element={<EB><OrgChartPage /></EB>} />
        {/* Person profile stays in Teams context - no redirect to /documents */}
        <Route path="team/:id" element={<EB><PersonEditorPage /></EB>} />
        <Route path="feedback/:id" element={<EB><FeedbackEditorPage /></EB>} />
        <Route path="settings" element={<EB><WorkspaceSettingsPage /></EB>} />
        <Route path="settings/conversions" element={<EB><ConvertedDocumentsPage /></EB>} />
        <Route path="developer/*" element={<EB><DeveloperPortal /></EB>} />
      </Route>
    </Routes>
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: queryPersister }}
    >
      <ToastProvider>
        <MutationErrorToast />
        <BrowserRouter>
          <ReviewQueueProvider>
            <App />
          </ReviewQueueProvider>
        </BrowserRouter>
      </ToastProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </PersistQueryClientProvider>
  </React.StrictMode>
);
