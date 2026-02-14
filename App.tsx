
import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import Customers from './pages/Customers';
import Contracts from './pages/Contracts';
import Projects from './pages/Projects';
import Finance from './pages/Finance';
import Knowledge from './pages/Knowledge';
import IntelRadar from './pages/IntelRadar';
import AICenter from './pages/AICenter';
import Strategy from './pages/Strategy';
import Audit from './pages/Audit';
import { AppProvider } from './context/AppContext';
import ProtectedRoute from './components/ProtectedRoute';

const App = () => {
  return (
    <AppProvider>
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/contracts" element={<Contracts />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/finance" element={<ProtectedRoute permission="NAV_FINANCE"><Finance /></ProtectedRoute>} />
            <Route path="/finance/settlements" element={<ProtectedRoute permission="NAV_FINANCE"><Finance /></ProtectedRoute>} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/intel" element={<ProtectedRoute permission="NAV_INTEL"><IntelRadar /></ProtectedRoute>} />
            <Route path="/strategy" element={<Strategy />} />
            <Route path="/ai-center" element={<AICenter />} />
          </Routes>
        </Layout>
      </Router>
    </AppProvider>
  );
};

export default App;
