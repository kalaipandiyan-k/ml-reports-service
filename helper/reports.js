const rp = require('request-promise');
const request = require('request');
const assessmentService = require('./assessment_service');
const helperFunc = require('./chart_data_v2');
const pdfHandler = require('./common_handler_v2');
const filesHelper = require('../common/files_helper');
const surveysHelper = require('./surveys');

// Instance observation report
exports.instaceObservationReport = async function (req, res) {

    return new Promise(async function (resolve, reject) {

        let bodyParam = gen.utils.getDruidQuery("instance_observation_query");

        if (process.env.OBSERVATION_DATASOURCE_NAME) {
            bodyParam.dataSource = process.env.OBSERVATION_DATASOURCE_NAME;
        }

        //Apply submissionId filter
        bodyParam.filter.fields[0].value = req.body.submissionId;

        //Push criteriaId or questionId filter based on the report Type (question wise and criteria wise)
        if (req.body.criteriaWise == false && req.body.filter && req.body.filter.questionId && req.body.filter.questionId.length > 0) {
            bodyParam.filter.fields.push({ "type": "in", "dimension": "questionExternalId", "values": req.body.filter.questionId });
            bodyParam.filter.fields.push({ "type": "not", "field": { "type": "selector", "dimension": "questionAnswer", "value": "" } });
        }

        if (req.body.criteriaWise == true && req.body.filter && req.body.filter.criteria && req.body.filter.criteria.length > 0) {
            bodyParam.filter.fields.push({ "type": "in", "dimension": "criteriaId", "values": req.body.filter.criteria });
            bodyParam.filter.fields.push({ "type": "not", "field": { "type": "selector", "dimension": "questionAnswer", "value": "" } });
        }

        let scoringSystem = "";

        if (req.body.scores == true) {
            scoringSystem = await getScoringSystem({ submissionId: req.body.submissionId});
        }

        bodyParam.dimensions = [];

        //Push dimensions to the query based on report type
        if (req.body.scores == false && req.body.criteriaWise == false) {
            bodyParam.dimensions.push("questionName", "questionAnswer", "school", "districtName", "schoolName", "remarks", "entityType", "observationName", "observationId", "questionResponseType", "questionResponseLabel", "questionId", "questionExternalId", "instanceId", "instanceParentQuestion", "instanceParentResponsetype", "instanceParentId", "questionSequenceByEcm", "instanceParentExternalId", "instanceParentEcmSequence");
        }

        if (req.body.scores == true && req.body.criteriaWise == false && scoringSystem == filesHelper.scoringSystem) {
            bodyParam.dimensions.push("questionName", "questionAnswer", "questionExternalId", "questionResponseType", "minScore", "maxScore", "totalScore", "scoreAchieved", "observationName");
            bodyParam.filter.fields.push({"type":"or","fields":[{"type":"selector","dimension":"questionResponseType","value":"radio"},{"type":"selector","dimension":"questionResponseType","value":"multiselect"},{"type":"selector","dimension":"questionResponseType","value":"slider"}]})
        }

        if (req.body.scores == false && req.body.criteriaWise == true) {
            bodyParam.dimensions.push("questionName", "questionAnswer", "school", "districtName", "schoolName", "remarks", "entityType", "observationName", "observationId", "questionResponseType", "questionResponseLabel", "questionId", "questionExternalId", "instanceId", "instanceParentQuestion", "instanceParentResponsetype", "instanceParentId", "questionSequenceByEcm", "instanceParentExternalId", "instanceParentEcmSequence", "criteriaName", "criteriaId", "instanceParentCriteriaName", "instanceParentCriteriaId");
        }

        if (req.body.scores == true && req.body.criteriaWise == true && scoringSystem == filesHelper.scoringSystem) {
            bodyParam.dimensions.push("questionName", "schoolName", "districtName", "questionAnswer", "questionExternalId", "questionResponseType", "minScore", "maxScore", "totalScore", "scoreAchieved", "observationName", "criteriaName", "criteriaId");
            bodyParam.filter.fields.push({"type":"or","fields":[{"type":"selector","dimension":"questionResponseType","value":"radio"},{"type":"selector","dimension":"questionResponseType","value":"multiselect"},{"type":"selector","dimension":"questionResponseType","value":"slider"}]})
        }

        if (req.body.scores == true && req.body.criteriaWise == false && scoringSystem !== filesHelper.scoringSystem) {
            bodyParam.dimensions.push("submissionId", "completedDate", "domainName", "criteriaDescription", "level", "label", "programName", "solutionName", "childExternalid", "childName", "childType");
        }

        //pass the query get the result from druid
        let options = gen.utils.getDruidConnection();
        options.method = "POST";
        options.body = bodyParam;
        let data = await rp(options);

        if (!data.length) {
            let message;
            let getSubmissionStatusResponse = await assessmentService.getObservationSubmissionStatusById
                (
                    submissionId,
                    req.headers["x-auth-token"]
                )

            if (getSubmissionStatusResponse.result &&
                getSubmissionStatusResponse.result.status == filesHelper.submission_status_completed) {
                message = filesHelper.submission_not_found_message
            }
            else {
                message = "SUBMISSION_ID_NOT_FOUND";
            }

            return resolve({
                "data": message
            });
        }
        else {

            let response;
            let chartData;
            let pdfReportUrl = process.env.APPLICATION_HOST_NAME + process.env.APPLICATION_BASE_URL + "v1/observations/pdfReportsUrl?id=";

            let evidenceData = await getEvidenceData({ submissionId: req.body.submissionId });

            //Send report based on input
            if (req.body.scores == false && req.body.criteriaWise == false) {

                chartData = await helperFunc.instanceReportChart(data);

                if (evidenceData.result) {
                    response = await helperFunc.evidenceChartObjectCreation(chartData, evidenceData.data, req.headers["x-auth-token"]);
                } else {
                    response = chartData;
                }

                if (req.body.pdf) {
                    let pdfReport = await pdfHandler.instanceObservationPdfGeneration(response, storeReportsToS3 = false);
                    if (pdfReport.status && pdfReport.status == "success") {
                        pdfReport.pdfUrl = pdfReportUrl + pdfReport.pdfUrl
                        return resolve(pdfReport);
                    } else {
                        return resolve(pdfReport);
                    }
                } else {
                    return resolve(response);
                }
            }

            if (req.body.scores == true && req.body.criteriaWise == false && scoringSystem == filesHelper.scoringSystem) {

                chartData = await helperFunc.instanceScoreReportChartObjectCreation(data);

                if (evidenceData.result) {
                    response = await helperFunc.evidenceChartObjectCreation(chartData, evidenceData.data, req.headers["x-auth-token"]);
                } else {
                    response = chartData;
                }

                if (req.body.pdf) {
                    let pdfHeaderInput = {
                        totalScore: response.totalScore,
                        scoreAchieved: response.scoreAchieved
                    }
                    let pdfReport = await pdfHandler.instanceScoreCriteriaPdfGeneration(response, storeReportsToS3 = false, pdfHeaderInput);
                    if (pdfReport.status && pdfReport.status == "success") {
                        pdfReport.pdfUrl = pdfReportUrl + pdfReport.pdfUrl
                        return resolve(pdfReport);
                    } else {
                        return resolve(pdfReport);
                    }
                } else {
                    return resolve(response);
                }
            }

            if (req.body.scores == false && req.body.criteriaWise == true) {

                let reportType = "criteria";
                chartData = await helperFunc.instanceReportChart(data, reportType);

                if (evidenceData.result) {
                    response = await helperFunc.evidenceChartObjectCreation(chartData, evidenceData.data, req.headers["x-auth-token"]);
                } else {
                    response = chartData;
                }

                response = await helperFunc.getCriteriawiseReport(response);

                if (req.body.pdf) {
                    let pdfReport = await pdfHandler.instanceCriteriaReportPdfGeneration(response, storeReportsToS3 = false);
                    if (pdfReport.status && pdfReport.status == "success") {
                        pdfReport.pdfUrl = pdfReportUrl + pdfReport.pdfUrl
                        return resolve(pdfReport);
                    } else {
                        return resolve(pdfReport);
                    }

                } else {
                    return resolve(response);
                }
            }

            if (req.body.scores == true && req.body.criteriaWise == true && scoringSystem == filesHelper.scoringSystem) {

                let reportType = "criteria";
                chartData = await helperFunc.instanceScoreReportChartObjectCreation(data, reportType);

                if (evidenceData.result) {
                    response = await helperFunc.evidenceChartObjectCreation(chartData, evidenceData.data, req.headers["x-auth-token"]);
                } else {
                    response = chartData;
                }

                response = await helperFunc.getCriteriawiseReport(response);

                if (req.body.pdf) {
                    let pdfHeaderInput = {
                        totalScore: response.totalScore,
                        scoreAchieved: response.scoreAchieved
                    }

                    let pdfReport = await pdfHandler.instanceScoreCriteriaPdfGeneration(response, storeReportsToS3 = false, pdfHeaderInput);
                    if (pdfReport.status && pdfReport.status == "success") {
                        pdfReport.pdfUrl = pdfReportUrl + pdfReport.pdfUrl
                        return resolve(pdfReport);
                    } else {
                        return resolve(pdfReport);
                    }

                } else {
                    return resolve(response);
                }
            }

            if (req.body.scores == true && req.body.criteriaWise == false && scoringSystem !== filesHelper.scoringSystem) {
                let response = {
                    "result": true,
                    "programName": data[0].event.programName,
                    "solutionName": data[0].event.solutionName,
                };

                chartData = await helperFunc.entityLevelReportData(data);

                response.reportSections = chartData;

                if (req.body.pdf) {
                    let pdfReport = await pdfHandler.assessmentAgainPdfReport(response, storeReportsToS3 = false);
                    pdfReport.pdfUrl = pdfReportUrl + pdfReport.pdfUrl
                    return resolve(response);
                } else {
                   return resolve(response);
                }
            }

        }
    })

}

// Entity Observation Report
exports.entityObservationReport = async function (req, res) {

    return new Promise(async function (resolve, reject) {

        let bodyParam = gen.utils.getDruidQuery("entity_observation_query");

        if (process.env.OBSERVATION_DATASOURCE_NAME) {
            bodyParam.dataSource = process.env.OBSERVATION_DATASOURCE_NAME;
        }

        let entityType = "school";

        if (req.body.entityType) {
            entityType = req.body.entityType;
        }

        bodyParam.filter.fields[0].dimension = entityType;
        bodyParam.filter.fields[0].value = req.body.entityId;
        bodyParam.filter.fields[1].value = req.body.observationId;
        bodyParam.filter.fields.push({ "type": "not", "field": { "type": "selector", "dimension": "questionAnswer", "value": "" } });

        // Push criteriaId or questionId filter based on the report Type (question wise and criteria wise)
        if (req.body.filter && req.body.filter.questionId && req.body.filter.questionId.length > 0) {
            bodyParam.filter.fields.push({ "type": "in", "dimension": "questionExternalId", "values": req.body.filter.questionId });
        }

        if (req.body.filter && req.body.filter.criteria && req.body.filter.criteria.length > 0) {
            bodyParam.filter.fields.push({ "type": "in", "dimension": "criteriaId", "values": req.body.filter.criteria });
        }

        let scoringSystem = "";

        if (req.body.scores == true) {
            scoringSystem = await getScoringSystem({
                entityId: req.body.entityId,
                observationId: req.body.observationId,
                entityType: req.body.entityType
            });
        }

        bodyParam.dimensions = [];

        //Push dimensions to the query based on report type
        if (req.body.scores == false && req.body.criteriaWise == false) {
            bodyParam.dimensions.push("completedDate", "questionName", "questionAnswer", "school", "schoolName", "entityType", "observationName", "observationId", "questionResponseType", "questionResponseLabel", "observationSubmissionId", "questionId", "questionExternalId", "instanceId", "instanceParentQuestion", "instanceParentResponsetype", "instanceParentId", "instanceParentEcmSequence", "instanceParentExternalId");
        }

        if (req.body.scores == true && req.body.criteriaWise == false && scoringSystem == filesHelper.scoringSystem) {
            bodyParam.dimensions.push("questionName", "questionExternalId", "questionResponseType", "minScore", "maxScore", "observationSubmissionId", "school", "schoolName", "districtName", "questionId", "completedDate", "observationName");
            bodyParam.filter.fields.push({ "type": "or", "fields": [{ "type": "selector", "dimension": "questionResponseType", "value": "radio" }, { "type": "selector", "dimension": "questionResponseType", "value": "multiselect" }, { "type": "selector", "dimension": "questionResponseType", "value": "slider" }] })
        }

        if (req.body.scores == false && req.body.criteriaWise == true) {
            bodyParam.dimensions.push("completedDate", "questionName", "questionAnswer", "school", "schoolName", "entityType", "observationName", "observationId", "questionResponseType", "questionResponseLabel", "observationSubmissionId", "questionId", "questionExternalId", "instanceId", "instanceParentQuestion", "instanceParentResponsetype", "instanceParentId", "instanceParentEcmSequence", "instanceParentExternalId", "criteriaName", "criteriaId", "instanceParentCriteriaName", "instanceParentCriteriaId");
        }

        if (req.body.scores == true && req.body.criteriaWise == true && scoringSystem == filesHelper.scoringSystem) {
            bodyParam.dimensions.push("questionName", "questionExternalId", "questionResponseType", "minScore", "maxScore", "observationSubmissionId", "school", "schoolName", "districtName", "questionId", "completedDate", "observationName", "criteriaName", "criteriaId");
            bodyParam.filter.fields.push({ "type": "or", "fields": [{ "type": "selector", "dimension": "questionResponseType", "value": "radio" }, { "type": "selector", "dimension": "questionResponseType", "value": "multiselect" }, { "type": "selector", "dimension": "questionResponseType", "value": "slider" }] })
        }

        if (req.body.scores == true && req.body.criteriaWise == false && scoringSystem !== filesHelper.scoringSystem) {
            bodyParam.filter.fields.push({"type":"selector","dimension":"createdBy","value": req.userDetails.userId});
            bodyParam.dimensions.push("observationSubmissionId", "submissionTitle", "completedDate", "domainName", "criteriaDescription", "level", "label", "programName", "solutionName", "childExternalid", "childName", "childType");
        }

        //pass the query get the result from druid
        let options = gen.utils.getDruidConnection();
        options.method = "POST";
        options.body = bodyParam;
        let data = await rp(options);

        if (!data.length) {
            let message;
            let getEntityObservationSubmissionsStatus = await assessmentService.getEntityObservationSubmissionsStatus
                (
                    req.body.entityId,
                    req.body.observationId,
                    req.headers["x-auth-token"]
                )

            if (getEntityObservationSubmissionsStatus.result &&
                getEntityObservationSubmissionsStatus.result.length > 0) {

                if (getEntityObservationSubmissionsStatus.result.filter(submission => submission.status === filesHelper.submission_status_completed).length > 0) {
                    message = filesHelper.submission_not_found_message
                }
            }
            else {
                message = "No observations made for the entity";
            }

            return resolve({
                "data": message
            });
        }
        else {

            let response;
            let chartData;
            let pdfReportUrl = process.env.APPLICATION_HOST_NAME + process.env.APPLICATION_BASE_URL + "v1/observations/pdfReportsUrl?id=";

            let evidenceData = await getEvidenceData(
                {
                    entityId: req.body.entityId,
                    observationId: req.body.observationId,
                    entityType: req.body.entityType
                });

            if (req.body.scores == false && req.body.criteriaWise == false) {

                chartData = await helperFunc.entityReportChart(data, req.body.entityId, req.body.entityType);

                if (evidenceData.result) {
                    response = await helperFunc.evidenceChartObjectCreation(chartData, evidenceData.data, req.headers["x-auth-token"]);
                } else {
                    response = chartData;
                }

                if (req.body.pdf) {
                    let pdfReport = await pdfHandler.pdfGeneration(response, storeReportsToS3 = false);
                    if (pdfReport.status && pdfReport.status == "success") {
                        pdfReport.pdfUrl = pdfReportUrl + pdfReport.pdfUrl
                        return resolve(pdfReport);
                    } else {
                        return resolve(pdfReport);
                    }
                } else {
                    return resolve(response);
                }
            }


            if (req.body.scores == true && req.body.criteriaWise == false && scoringSystem == filesHelper.scoringSystem) {

                chartData = await helperFunc.entityScoreReportChartObjectCreation(data);
                chartData.entityName = data[0].event[req.body.entityType + "Name"];

                if (evidenceData.result) {
                    response = await helperFunc.evidenceChartObjectCreation(chartData, evidenceData.data, req.headers["x-auth-token"]);
                } else {
                    response = chartData;
                }

                if (req.body.pdf) {
                    let pdfHeaderInput = {
                        entityName: response.entityName,
                        totalObservations: response.totalObservations
                    }
                    let pdfReport = await pdfHandler.instanceObservationScorePdfGeneration(response, storeReportsToS3 = false, pdfHeaderInput);
                    if (pdfReport.status && pdfReport.status == "success") {
                        pdfReport.pdfUrl = pdfReportUrl + pdfReport.pdfUrl
                        return resolve(pdfReport);
                    } else {
                        return resolve(pdfReport);
                    }
                } else {
                    return resolve(response);
                }
            }

            if (req.body.scores == false && req.body.criteriaWise == true) {

                let reportType = "criteria";
                chartData = await helperFunc.entityReportChart(data, req.body.entityId, req.body.entityType, reportType);

                if (evidenceData.result) {
                    response = await helperFunc.evidenceChartObjectCreation(chartData, evidenceData.data, req.headers["x-auth-token"]);
                } else {
                    response = chartData;
                }

                response = await helperFunc.getCriteriawiseReport(response);

                if (req.body.pdf) {
                    let pdfReport = await pdfHandler.entityCriteriaPdfReportGeneration(response, storeReportsToS3 = false);
                    if (pdfReport.status && pdfReport.status == "success") {
                        pdfReport.pdfUrl = pdfReportUrl + pdfReport.pdfUrl
                        return resolve(pdfReport);
                    } else {
                        return resolve(pdfReport);
                    }
                } else {
                    return resolve(response);
                }
            }

            if (req.body.scores == true && req.body.criteriaWise == true && scoringSystem == filesHelper.scoringSystem) {

                let reportType = "criteria";
                chartData = await helperFunc.instanceScoreReportChartObjectCreation(data, reportType);
                chartData.entityName = data[0].event[req.body.entityType + "Name"];

                if (evidenceData.result) {
                    response = await helperFunc.evidenceChartObjectCreation(chartData, evidenceData.data, req.headers["x-auth-token"]);
                } else {
                    response = chartData;
                }

                response = await helperFunc.getCriteriawiseReport(response);

                if (req.body.pdf) {
                    let pdfHeaderInput = {
                        entityName: response.entityName,
                        totalObservations: response.totalObservations
                    }

                    let pdfReport = await pdfHandler.instanceScoreCriteriaPdfGeneration(response, storeReportsToS3 = false, pdfHeaderInput);
                    if (pdfReport.status && pdfReport.status == "success") {
                        pdfReport.pdfUrl = pdfReportUrl + pdfReport.pdfUrl
                        return resolve(pdfReport);
                    } else {
                        return resolve(pdfReport);
                    }

                } else {
                    return resolve(response);
                }
            }

            if (req.body.scores == true && req.body.criteriaWise == false && scoringSystem !== filesHelper.scoringSystem) {

                let response = {
                    "result": true,
                    "programName": data[0].event.programName,
                    "solutionName": data[0].event.solutionName,
                };

                chartData = await helperFunc.entityLevelReportData(data);

                response.reportSections = chartData;

                if (response.reportSections[1].chart.totalSubmissions == 1) {
                    response.reportSections[0].chart.submissionDateArray = [];
                }

                if (req.body.pdf) {

                    let pdfReport = await pdfHandler.assessmentAgainPdfReport(response, storeReportsToS3 = false);
                    pdfReport.pdfUrl = pdfReportUrl + pdfReport.pdfUrl
                    return resolve(pdfReport);

                } else {
                    return resolve(response);
                }
            }

        }
    })
}


//Survey report
exports.surveyReport = async function (req, res) {

    return new Promise(async function (resolve, reject) {

        if (req.body.submissionId) {
            let response = await surveysHelper.surveySubmissionReport(req, res);
            return resolve(response);
        }

        if (req.body.solutionId) {
            let response = await surveysHelper.surveySolutionReport(req, res);
            return resolve(response);
        }
    })
}


// Get scoring system
const getScoringSystem = async function (inputData) {

    return new Promise(async function (resolve, reject) {

        let query = {};
        let scoringSystem = "";

        if (inputData.submissionId) {
            query = { "queryType": "groupBy", "dataSource": process.env.OBSERVATION_DATASOURCE_NAME, "granularity": "all", "dimensions": ["scoringSystem"], "filter": { "type": "selector", "dimension": "observationSubmissionId", "value": submissionId }, "aggregations": [], "postAggregations": [], "limitSpec": {}, "intervals": ["1901-01-01T00:00:00+00:00/2101-01-01T00:00:00+00:00"] }
        }

        if (inputData.entityId && inputData.observationId) {
            query = { "queryType": "groupBy", "dataSource": process.env.OBSERVATION_DATASOURCE_NAME, "granularity": "all", "dimensions": ["scoringSystem"], "filter": { "type": "and", "fileds": [{ "type": "selector", "dimension": entityType, "value": entityId }, { "type": "selector", "dimension": "observationId", "value": observationId }] }, "aggregations": [], "postAggregations": [], "limitSpec": {}, "intervals": ["1901-01-01T00:00:00+00:00/2101-01-01T00:00:00+00:00"] }
        }

        //pass the query get the result from druid
        let options = gen.utils.getDruidConnection();
        options.method = "POST";
        options.body = query;
        let data = await rp(options);

        if (data.length) {
            scoringSystem = data[0].event.scoringSystem;
        }

        return resolve(scoringSystem);

    })
}


// Get the evidence data
async function getEvidenceData(inputObj) {

    return new Promise(async function (resolve, reject) {
  
      try {
  
        let submissionId = inputObj.submissionId;
        let entityId = inputObj.entity;
        let observationId = inputObj.observationId;
        let entityType = inputObj.entityType;
  
        // let bodyParam = JSON.parse(result.query);
        let bodyParam = gen.utils.getDruidQuery("get_evidence_query");
  
        //based on the given input change the filter
        let filter = {};
  
        if (submissionId) {
          filter = { "type": "selector", "dimension": "observationSubmissionId", "value": submissionId }
        } else if (entityId && observationId) {
          filter = { "type": "and", "fileds": [{ "type": "selector", "dimension": entityType, "value": entityId }, { "type": "selector", "dimension": "observationId", "value": observationId }] }
        } else if (observationId) {
          filter = { "type": "selector", "dimension": "observationId", "value": observationId }
        }
  
        if (process.env.OBSERVATION_EVIDENCE_DATASOURCE_NAME) {
          bodyParam.dataSource = process.env.OBSERVATION_EVIDENCE_DATASOURCE_NAME;
        }
  
        bodyParam.filter = filter;
  
        //pass the query as body param and get the resul from druid
        let options = gen.utils.getDruidConnection();
        options.method = "POST";
        options.body = bodyParam;
        let data = await rp(options);
  
        if (!data.length) {
          resolve({
            "result": false,
            "data": "EVIDENCE_NOT_FOUND"
          });
        } else {
          resolve({ "result": true, "data": data });
        }
  
      }
      catch (err) {
        let response = {
          result: false,
          message: "Internal server error"
        };
        resolve(response);
      };
    })
}