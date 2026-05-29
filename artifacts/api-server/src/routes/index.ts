import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import botsRouter from "./bots.js";
import metaRouter from "./meta.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(metaRouter);
router.use(botsRouter);

export default router;
