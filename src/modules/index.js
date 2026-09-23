'use strict';

module.exports = [
  { path: '/api/catalogs', router: require('./catalogs/catalog.routes') },
  { path: '/api/advisors', router: require('./advisors/advisor.routes') },
  { path: '/api/accounts', router: require('./accounts/account.routes') },
  { path: '/api/campaigns', router: require('./campaigns/campaign.routes') },
  { path: '/api/campaign-queue', router: require('./campaignQueue/campaignQueue.routes') },
  { path: '/api/leads', router: require('./leads/lead.routes') },
  { path: '/api/lead-events', router: require('./leadEvents/leadEvent.routes') },
  { path: '/api/follow-ups', router: require('./followUps/followUp.routes') },
  { path: '/api/commercial-requests', router: require('./commercialRequests/commercialRequest.routes') },
  { path: '/api/meetings', router: require('./meetings/meeting.routes') },
  { path: '/api/price-snapshots', router: require('./priceSnapshots/priceSnapshot.routes') },
  { path: '/api/pricing-settings', router: require('./pricingSettings/pricingSetting.routes') },
  { path: '/api/opportunities', router: require('./opportunities/opportunity.routes') },
  { path: '/api/workflow-rules', router: require('./rules/workflowRule.routes') },
  { path: '/api/contact-policies', router: require('./policies/contactPolicy.routes') },
  { path: '/api/integrations', router: require('./integrations/integration.routes') },
  { path: '/api/audit-logs', router: require('./audit/audit.routes') },
  { path: '/api/reports', router: require('./reports/report.routes') }
];
