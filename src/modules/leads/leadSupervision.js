'use strict';

function supervisionTimeline(reviews = []) {
  return reviews.flatMap(review => {
    const common = {
      leadId: String(review.leadId), reviewId: String(review._id),
      source: 'Supervisión', status: review.status, dueAt: review.dueAt, resolutionType: review.resolutionType || 'response'
    };
    const entries = [{
      ...common, id: `supervision-${review._id}`, type: 'supervision',
      title: 'Supervisión · Indicación', detail: review.note,
      actor: review.createdBy || null, at: review.createdAt
    }];
    if (review.status === 'resolved' && review.resolvedAt && review.resolutionType !== 'lead_closed') entries.push({
      ...common, id: `supervision-response-${review._id}`, type: 'supervision_response',
      title: 'Supervisión · Respuesta del asesor', detail: review.resolution || '',
      note: review.note, actor: review.resolvedBy || null, at: review.resolvedAt
    });
    return entries;
  });
}

function pendingReviewsPipeline(userId, businessUnits, { page, limit }) {
  return [
    { $match: { assignedAdvisorId: String(userId), status: 'pending' } },
    { $lookup: { from: 'leads', localField: 'leadId', foreignField: '_id', as: 'lead' } },
    { $unwind: '$lead' },
    { $match: { 'lead.assignedAdvisorId': String(userId), 'lead.businessUnit': { $in: businessUnits } } },
    { $sort: { createdAt: -1, _id: -1 } },
    { $facet: {
      items: [{ $skip: (page - 1) * limit }, { $limit: limit }, { $project: {
        leadId: 1, note: 1, dueAt: 1, createdAt: 1, createdBy: 1,
        leadCode: '$lead.code', leadName: '$lead.name', companyName: '$lead.companyName'
      } }],
      total: [{ $count: 'count' }]
    } }
  ];
}

module.exports = { supervisionTimeline, pendingReviewsPipeline };
