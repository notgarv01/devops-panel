const EventEmitter = require('events');

// In-memory queue that properly processes jobs asynchronously
class InMemoryQueue extends EventEmitter {
  constructor(name, options = {}) {
    super();
    this.name = name;
    this.jobs = [];
    this.processors = [];
    this.concurrency = 1;
  }

  async add(jobName, data, options = {}) {
    const job = {
      id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: jobName,
      data,
      opts: options,
      progress: 0,
      status: 'waiting',
      createdAt: new Date(),
      processedAt: null,
      completedAt: null,
      failedReason: null
    };

    this.jobs.push(job);
    this.emit('waiting', job);

    // Process immediately if we have processors
    this._processNext();

    return job;
  }

  process(fn, concurrency = 1) {
    this.concurrency = concurrency;
    this.processors.push(fn);
    console.log(`[Queue:${this.name}] Processor registered, ${this.jobs.filter(j => j.status === 'waiting').length} jobs pending`);

    // Process any existing waiting jobs
    this._processNext();
  }

  _processNext() {
    if (this.processors.length === 0) {
      console.log(`[Queue:${this.name}] No processor registered, job queued`);
      return;
    }

    const waitingJobs = this.jobs.filter(j => j.status === 'waiting');
    if (waitingJobs.length === 0) return;

    const job = waitingJobs[0];
    const processor = this.processors[this.processors.length - 1];

    console.log(`[Queue:${this.name}] Processing job ${job.id}`);

    job.status = 'active';
    job.processedAt = new Date();
    this.emit('active', job);

    // Run in async context so we don't block
    Promise.resolve()
      .then(() => processor(job.data, job))
      .then(result => {
        job.status = 'completed';
        job.completedAt = new Date();
        this.emit('completed', job);
        this.emit('succeeded', job);
        console.log(`[Queue:${this.name}] Job ${job.id} completed`);
      })
      .catch(error => {
        job.status = 'failed';
        job.failedReason = error.message;
        this.emit('failed', job);
        console.log(`[Queue:${this.name}] Job ${job.id} failed: ${error.message}`);
      })
      .finally(() => {
        // Process next job if any
        const remaining = this.jobs.filter(j => j.status === 'waiting');
        if (remaining.length > 0) {
          setImmediate(() => this._processNext());
        }
      });
  }

  async getJob(jobId) {
    return this.jobs.find(j => j.id === jobId) || null;
  }

  async getActive() {
    return this.jobs.filter(j => j.status === 'active');
  }

  async getWaiting() {
    return this.jobs.filter(j => j.status === 'waiting');
  }

  async getCompleted() {
    return this.jobs.filter(j => j.status === 'completed');
  }

  async getFailed() {
    return this.jobs.filter(j => j.status === 'failed');
  }

  async clean(type, count, grace) {
    if (type === 'completed') {
      this.jobs = this.jobs.filter(j => j.status !== 'completed');
    } else if (type === 'failed') {
      this.jobs = this.jobs.filter(j => j.status !== 'failed');
    }
  }

  on(event, fn) {
    super.on(event, fn);
    return this;
  }

  close() {
    this.jobs = [];
    this.processors = [];
    this.removeAllListeners();
  }
}

// Queue Manager
class QueueManager {
  constructor(redisUrl = null) {
    this.redisUrl = redisUrl;
    this.queues = new Map();
    this.useRedis = false;
  }

  async init() {
    if (this.redisUrl) {
      try {
        const Redis = require('ioredis');
        const testClient = new Redis(this.redisUrl, { maxRetriesPerRequest: 1 });
        await testClient.ping();
        testClient.disconnect();
        this.useRedis = true;
        console.log('[Queue] Using Redis for job processing');
      } catch (error) {
        console.log('[Queue] Redis unavailable, using in-memory fallback');
        this.useRedis = false;
      }
    } else {
      console.log('[Queue] No Redis configured, using in-memory fallback');
      this.useRedis = false;
    }
  }

  getQueue(name) {
    if (!this.queues.has(name)) {
      if (this.useRedis) {
        const BullQueue = require('bull');
        this.queues.set(name, new BullQueue(name, this.redisUrl));
      } else {
        this.queues.set(name, new InMemoryQueue(name));
      }
    }
    return this.queues.get(name);
  }

  async addJob(queueName, jobName, data, options = {}) {
    const queue = this.getQueue(queueName);
    return queue.add(jobName, data, options);
  }

  async processQueue(queueName, processor, concurrency = 1) {
    const queue = this.getQueue(queueName);
    queue.process((data, job) => processor(data, job), concurrency);
  }

  getQueueStatus(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) return { waiting: 0, active: 0, completed: 0, failed: 0 };

    return {
      waiting: queue.jobs?.filter(j => j.status === 'waiting').length || 0,
      active: queue.jobs?.filter(j => j.status === 'active').length || 0,
      completed: queue.jobs?.filter(j => j.status === 'completed').length || 0,
      failed: queue.jobs?.filter(j => j.status === 'failed').length || 0
    };
  }

  async closeAll() {
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    this.queues.clear();
  }
}

// Singleton instance
let queueManager = null;

const initQueueManager = (redisUrl = null) => {
  if (!queueManager) {
    queueManager = new QueueManager(redisUrl);
  }
  return queueManager;
};

const getQueueManager = () => queueManager;

module.exports = {
  QueueManager,
  InMemoryQueue,
  initQueueManager,
  getQueueManager
};