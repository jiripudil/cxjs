import {Widget, VDOM, getContent} from './Widget';
import {Instance} from './Instance';
import {RenderingContext} from './RenderingContext';
import {debug, appDataFlag} from '../util/Debug';
import {Timing, now, appLoopFlag, vdomRenderFlag} from '../util/Timing';
import { isBatchingUpdates, notifyBatchedUpdateStarting, notifyBatchedUpdateCompleted } from './batchUpdates';

export class Cx extends VDOM.Component {
   constructor(props) {
      super(props);

      if (props.instance) {
         this.widget = props.instance.widget;
         this.store = props.instance.store;
      }
      else {
         this.widget = Widget.create(props.widget || props.items[0]);

         if (props.parentInstance) {
            this.parentInstance = props.parentInstance;
            this.store = props.store || this.parentInstance.store;
         }
         else {
            this.parentInstance = new Instance(this.widget, 0);
            this.store = props.store;
         }

         if (!this.store)
            throw new Error('Cx component requires store.');
      }

      if (props.subscribe)
         this.unsubscribe = this.store.subscribe(::this.update);

      this.flags = {};
      this.renderCount = 0;
   }

   render() {
      if (!this.widget)
         return null;

      let instance = this.props.instance || this.parentInstance.getChild(this.context, this.widget, null, this.store);
      return <CxContext instance={instance} flags={this.flags} options={this.props.options}
         buster={++this.renderCount }/>
   }

   componentDidMount() {
      this.componentDidUpdate();

      if (this.props.options && this.props.options.onPipeUpdate)
         this.props.options.onPipeUpdate(::this.update);
   }

   componentDidUpdate() {
      if (this.flags.dirty) {
         this.update();
      }
   }

   update() {
      let data = this.store.getData();
      debug(appDataFlag, data);
      if (this.flags.preparing)
         this.flags.dirty = true;
      else if (isBatchingUpdates() || this.props.immediate) {
         notifyBatchedUpdateStarting();
         this.setState({data: data}, notifyBatchedUpdateCompleted);
      } else {
         //in standard mode sequential store commands are batched
         if (!this.pendingUpdateTimer) {
            notifyBatchedUpdateStarting();
            this.pendingUpdateTimer = setTimeout(() => {
               delete this.pendingUpdateTimer;
               this.setState({data: data}, notifyBatchedUpdateCompleted);
            }, 0);
         }
      }
   }

   componentWillUnmount() {
      if (this.pendingUpdateTimer)
         clearTimeout(this.pendingUpdateTimer);
      if (this.unsubscribe)
         this.unsubscribe();
      if (this.props.options && this.props.options.onPipeUpdate)
         this.props.options.onPipeUpdate(null);
   }
}


class CxContext extends VDOM.Component {

   constructor(props) {
      super(props);
      this.renderCount = 0;
      this.componentWillReceiveProps(props);
   }

   componentWillReceiveProps(props) {

      this.timings = {
         start: now()
      };

      let {instance, options} = props;
      let count = 0, visible, context;

      if (this.props.instance !== instance && this.props.instance.destroyTracked)
         this.props.instance.destroy();

      this.props.flags.preparing = true;

      do {
         context = new RenderingContext(options);
         this.props.flags.dirty = false;
         visible = instance.explore(context);
      }
      while (visible && this.props.flags.dirty && ++count <= 3 && Widget.optimizePrepare);

      if (visible) {
         this.timings.afterExplore = now();
         instance.prepare(context);
         this.timings.afterPrepare = now();

         let result = instance.render(context);
         this.content = getContent(result);
         this.timings.afterRender = now();
      }
      else {
         this.content = null;
         this.timings.afterExplore = this.timings.afterPrepare = this.timings.afterRender = now();
      }

      this.timings.beforeVDOMRender = now();
      this.props.flags.preparing = false;
      this.props.flags.rendering = true;
      this.renderingContext = context;
   }

   render() {
      return this.content;
   }

   componentDidMount() {
      this.componentDidUpdate();
   }

   componentDidUpdate() {
      this.props.flags.rendering = false;
      this.timings.afterVDOMRender = now();

      let {instance} = this.props;
      instance.cleanup(this.renderingContext);

      this.timings.afterCleanup = now();
      this.renderCount++;

      if (process.env.NODE_ENV !== "production") {

         let {start, beforeVDOMRender, afterVDOMRender, afterPrepare, afterExplore, afterRender, afterCleanup} = this.timings;

         Timing.log(
            vdomRenderFlag,
            this.renderCount,
            'cx', (beforeVDOMRender - start + afterCleanup - afterVDOMRender).toFixed(2) + 'ms',
            'vdom', (afterVDOMRender - beforeVDOMRender).toFixed(2) + 'ms'
         );

         Timing.log(
            appLoopFlag,
            this.renderCount,
            this.renderingContext.options.name || 'main',
            'total', (afterCleanup - start).toFixed(1) + 'ms',
            'explore', (afterExplore - start).toFixed(1) + 'ms',
            'prepare', (afterPrepare - afterExplore).toFixed(1),
            'render', (afterRender - afterPrepare).toFixed(1),
            'vdom', (afterVDOMRender - beforeVDOMRender).toFixed(1),
            'cleanup', (afterCleanup - afterVDOMRender).toFixed(1)
         );
      }
   }

   componentWillUnmount() {
      let {instance} = this.props;
      if (instance.destroyTracked)
         instance.destroy();
   }
}
