'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const Lead = require('../leads/lead.model');
const Campaign = require('../campaigns/campaign.model');
const CampaignQueue = require('../campaignQueue/campaignQueue.model');
const FollowUp = require('../followUps/followUp.model');
const Opportunity = require('../opportunities/opportunity.model');
const { isAdminUser } = require('../../middlewares/auth.middleware');
const { allowedBusinessUnits } = require('../shared/leadLineAccess');

exports.summary = asyncHandler(async (req, res) => {
  const isAdmin = isAdminUser(req.user);
  const businessUnits = allowedBusinessUnits(req.user);
  const advisorFilter = isAdmin && req.query.assignedAdvisorId
    ? req.query.assignedAdvisorId
    : req.user.id;

  const leadFilter = { businessUnit: { $in: businessUnits } };
  const opportunityFilter = { businessUnit: { $in: businessUnits } };
  if (!isAdmin || req.query.assignedAdvisorId) {
    leadFilter.assignedAdvisorId = advisorFilter;
    opportunityFilter.assignedAdvisorId = advisorFilter;
  }

  const advisorQueueFilter = isAdmin && !req.query.assignedAdvisorId
    ? {}
    : { assignedAdvisorId: advisorFilter };
  const assignedCampaignIds = isAdmin
    ? null
    : await CampaignQueue.distinct('campaignId', advisorQueueFilter);
  const campaignFilter = { businessUnit: { $in: businessUnits } };
  if (assignedCampaignIds) campaignFilter._id = { $in: assignedCampaignIds };

  const [allowedLeadIds, allowedCampaignIds] = await Promise.all([
    Lead.distinct('_id', leadFilter),
    Campaign.distinct('_id', campaignFilter)
  ]);
  const queueFilter = {
    ...advisorQueueFilter,
    campaignId: { $in: allowedCampaignIds }
  };

  const [
    leadsByStatus,
    campaignsByStatus,
    queueByStatus,
    pendingFollowUps,
    opportunitiesByStage
  ] = await Promise.all([
    Lead.aggregate([{ $match: leadFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Campaign.aggregate([{ $match: campaignFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    CampaignQueue.aggregate([{ $match: queueFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    FollowUp.countDocuments({ leadId: { $in: allowedLeadIds }, status: 'pending', dueAt: { $lte: new Date() } }),
    Opportunity.aggregate([{ $match: opportunityFilter }, { $group: { _id: '$stage', count: { $sum: 1 } } }])
  ]);

  res.json({
    leadsByStatus,
    campaignsByStatus,
    queueByStatus,
    pendingFollowUps,
    opportunitiesByStage
  });
});
