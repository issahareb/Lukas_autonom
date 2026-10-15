import { Router, type IRouter } from "express";
import healthRouter from "./health";
import lukasRouter from "./lukas";
import higgsfieldRouter from "./higgsfield";
import anthropicRouter from "./anthropic";
import tradesRouter from "./trades";
import publicRouter from "./public";
import publicBrainRouter from "./public-brain";
import attachmentsRouter from "./attachments";
import whatsappRouter from "./whatsapp";
import approvalsRouter from "./approvals";
import proposalsRouter from "./proposals";
import mcpRouter from "./mcp";
import telefonRouter from "./telefon";
import telefonAnfragenRouter from "./telefon-anfragen";

import taxiAnalyticsRouter from "./taxibb-analytics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(taxiAnalyticsRouter);
router.use(lukasRouter);
router.use(higgsfieldRouter);
router.use(anthropicRouter);
router.use(tradesRouter);
router.use(publicRouter);
router.use(publicBrainRouter);
router.use(attachmentsRouter);
router.use(whatsappRouter);
router.use(approvalsRouter);
router.use(proposalsRouter);
router.use(mcpRouter);
router.use(telefonAnfragenRouter);
router.use(telefonRouter);

export default router;
