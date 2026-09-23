'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const Lead = require('../leads/lead.model');
const Campaign = require('../campaigns/campaign.model');
const CampaignQueue = require('../campaignQueue/campaignQueue.model');
const FollowUp = require('../followUps/followUp.model');
const Opportunity = require('../opportunities/opportunity.model');
const { isAdminUser } = require('../../middlewares/auth.middleware');

exports.summary = asyncHandler(async (req, res) => {
  const isAdmin = isAdminUser(req.user);
  const advisorFilter = isAdmin && req.query.assignedAdvisorId
    ? req.query.assignedAdvisorId
    : req.user.id;

  const leadFilter = isAdmin && !req.query.assignedAdvisorId
    ? {}
    : { assignedAdvisorId: advisorFilter };
  const queueFilter = isAdmin && !req.query.assignedAdvisorId
    ? {}
    : { assignedAdvisorId: advisorFilter };
  const campaignFilter = isAdmin
    ? {}
    : { _id: { $in: await CampaignQueue.distinct('campaignId', queueFilter) } };

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
    FollowUp.countDocuments({ ...leadFilter, status: 'pending', dueAt: { $lte: new Date() } }),
    Opportunity.aggregate([{ $match: leadFilter }, { $group: { _id: '$stage', count: { $sum: 1 } } }])
  ]);

  res.json({
    leadsByStatus,
    campaignsByStatus,
    queueByStatus,
    pendingFollowUps,
    opportunitiesByStage
  });
});
