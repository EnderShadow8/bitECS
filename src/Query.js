import { SparseSet } from './Util.js'
import { $queryShadow, $storeFlattened, $tagStore, createShadow } from './Storage.js'
import { $componentMap, registerComponent } from './Component.js'
import { $entityMasks, $entityArray, getEntityCursor, $entitySparseSet } from './Entity.js'



export function Not(c) { return () => [c, 'not'] }
export function Or(c) { return () => [c, 'or'] }
export function Changed(c) { return () => [c, 'changed'] }

export function Any(...comps) { return function QueryAny() { return comps } }
export function All(...comps) { return function QueryAll() { return comps } }
export function None(...comps) { return function QueryNone() { return comps } }

export const $queries = Symbol('queries')
export const $notQueries = Symbol('notQueries')

export const $queryAny = Symbol('queryAny')
export const $queryAll = Symbol('queryAll')
export const $queryNone = Symbol('queryNone')

export const $queryMap = Symbol('queryMap')
export const $dirtyQueries = Symbol('$dirtyQueries')
export const $queryComponents = Symbol('queryComponents')
export const $enterQuery = Symbol('enterQuery')
export const $exitQuery = Symbol('exitQuery')

/**
 * Given an existing query, returns a new function which returns entities who have been added to the given query since the last call of the function.
 *
 * @param {function} query
 * @returns {function} enteredQuery
 */
export const enterQuery = query => world => {
  if (!world[$queryMap].has(query)) registerQuery(world, query)
  const q = world[$queryMap].get(query)
  return q.entered.splice(0)
}

/**
 * Given an existing query, returns a new function which returns entities who have been removed from the given query since the last call of the function.
 *
 * @param {function} query
 * @returns {function} enteredQuery
 */
export const exitQuery = query => world => {
  if (!world[$queryMap].has(query)) registerQuery(world, query)
  const q = world[$queryMap].get(query)
  return q.exited.splice(0)
}

export const registerQuery = (world, query) => {

  const components = []
  const notComponents = []
  const changedComponents = []

  query[$queryComponents].forEach(c => {
    if (typeof c === 'function') {
      const [comp, mod] = c()
      if (!world[$componentMap].has(comp)) registerComponent(world, comp)
      if (mod === 'not') {
        notComponents.push(comp)
      }
      if (mod === 'changed') {
        changedComponents.push(comp)
        components.push(comp)
      }
    } else {
      if (!world[$componentMap].has(c)) registerComponent(world, c)
      components.push(c)
    }
  })


  const mapComponents = c => world[$componentMap].get(c)

  const allComponents = components.concat(notComponents).map(mapComponents)

  // const sparseSet = Uint32SparseSet(getGlobalSize())
  const sparseSet = SparseSet()

  const archetypes = []
  // const changed = SparseSet()
  const changed = []
  const toRemove = []
  const entered = []
  const exited = []

  const generations = allComponents
    .map(c => c.generationId)
    .reduce((a,v) => {
      if (a.includes(v)) return a
      a.push(v)
      return a
    }, [])

  const reduceBitflags = (a,c) => {
    if (!a[c.generationId]) a[c.generationId] = 0
    a[c.generationId] |= c.bitflag
    return a
  }
  const masks = components
    .map(mapComponents)
    .reduce(reduceBitflags, {})

  const notMasks = notComponents
    .map(mapComponents)
    .reduce(reduceBitflags, {})

  // const orMasks = orComponents
  //   .map(mapComponents)
  //   .reduce(reduceBitmasks, {})

  const hasMasks = allComponents
    .reduce(reduceBitflags, {})

  const flatProps = components
    .filter(c => !c[$tagStore])
    .map(c => Object.getOwnPropertySymbols(c).includes($storeFlattened) ? c[$storeFlattened] : [c])
    .reduce((a,v) => a.concat(v), [])

  const shadows = flatProps.map(prop => {
      const $ = Symbol()
      createShadow(prop, $)
      return prop[$]
  }, [])

  const q = Object.assign(sparseSet, {
    archetypes,
    changed,
    components,
    notComponents,
    changedComponents,
    masks,
    notMasks,
    // orMasks,
    hasMasks,
    generations,
    flatProps,
    toRemove,
    entered,
    exited,
    shadows,
  })
  
  world[$queryMap].set(query, q)
  world[$queries].add(q)
  
  allComponents.forEach(c => {
    c.queries.add(q)
  })

  if (notComponents.length) world[$notQueries].add(q)

  for (let eid = 0; eid < getEntityCursor(); eid++) {
    if (!world[$entitySparseSet].has(eid)) continue
    if (queryCheckEntity(world, q, eid)) {
      queryAddEntity(q, eid)
    }
  }
}

const diff = (q, clearDiff) => {
  if (clearDiff) q.changed = []
  const { flatProps, shadows } = q
  for (let i = 0; i < q.dense.length; i++) {
    const eid = q.dense[i]
    let dirty = false
    for (let pid = 0; pid < flatProps.length; pid++) {
      const prop = flatProps[pid]
      const shadow = shadows[pid]
      // console.log('hi', shadow)
      if (ArrayBuffer.isView(prop[eid])) {
        for (let i = 0; i < prop[eid].length; i++) {
          if (prop[eid][i] !== shadow[eid][i]) {
            dirty = true
            shadow[eid][i] = prop[eid][i]
            break
          }
        }
      } else {
        if (prop[eid] !== shadow[eid]) {
          dirty = true
          shadow[eid] = prop[eid]
        }
      }
    }
    if (dirty) q.changed.push(eid)
  }
  return q.changed
}

// const queryEntityChanged = (q, eid) => {
//   if (q.changed.has(eid)) return
//   q.changed.add(eid)
// }

// export const entityChanged = (world, component, eid) => {
//   const { changedQueries } = world[$componentMap].get(component)
//   changedQueries.forEach(q => {
//     const match = queryCheckEntity(world, q, eid)
//     if (match) queryEntityChanged(q, eid)
//   })
// }

const flatten = (a,v) => a.concat(v)

const aggregateComponentsFor = mod => x => x.filter(f => f.name === mod().constructor.name).reduce(flatten)

const getAnyComponents = aggregateComponentsFor(Any)
const getAllComponents = aggregateComponentsFor(All)
const getNoneComponents = aggregateComponentsFor(None)

/**
 * Defines a query function which returns a matching set of entities when called on a world.
 *
 * @param {array} components
 * @returns {function} query
 */

export const defineQuery = (...args) => {
  let components
  let any, all, none
  if (Array.isArray(args[0])) {
    components = args[0]
  } else {
    any = getAnyComponents(args)
    all = getAllComponents(args)
    none = getNoneComponents(args)
  }
  

  if (components === undefined || components[$componentMap] !== undefined) {
    return world => world ? world[$entityArray] : components[$entityArray]
  }

  const query = function (world, clearDiff=true) {
    if (!world[$queryMap].has(query)) registerQuery(world, query)

    const q = world[$queryMap].get(query)

    commitRemovals(world)

    if (q.changedComponents.length) return diff(q, clearDiff)
    // if (q.changedComponents.length) return q.changed.dense

    return q.dense
  }

  query[$queryComponents] = components
  query[$queryAny] = any
  query[$queryAll] = all
  query[$queryNone] = none

  return query
}

// TODO: archetype graph
export const queryCheckEntity = (world, q, eid) => {
  const { masks, notMasks, generations } = q
  let or = 0
  for (let i = 0; i < generations.length; i++) {
    const generationId = generations[i]
    const qMask = masks[generationId]
    const qNotMask = notMasks[generationId]
    // const qOrMask = orMasks[generationId]
    const eMask = world[$entityMasks][generationId][eid]
    
    // any
    // if (qOrMask && (eMask & qOrMask) !== qOrMask) {
    //   continue
    // }
    // none
    if (qNotMask && (eMask & qNotMask) === qNotMask) {
      return false
    }
    // all
    if (qMask && (eMask & qMask) !== qMask) {
      return false
    }
  }
  return true
}

export const queryCheckComponent = (q, c) => {
  const { generationId, bitflag } = c
  const { hasMasks } = q
  const mask = hasMasks[generationId]
  return (mask & bitflag) === bitflag
}

export const queryAddEntity = (q, eid) => {
  if (q.has(eid)) return
  q.add(eid)
  q.entered.push(eid)
}

const queryCommitRemovals = (q) => {
  while (q.toRemove.length) {
    q.remove(q.toRemove.pop())
  }
}

export const commitRemovals = (world) => {
  world[$dirtyQueries].forEach(queryCommitRemovals)
  world[$dirtyQueries].clear()
}

export const queryRemoveEntity = (world, q, eid) => {
  if (!q.has(eid)) return
  q.toRemove.push(eid)
  world[$dirtyQueries].add(q)
  q.exited.push(eid)
}


/**
 * Resets a Changed-based query, clearing the underlying list of changed entities.
 *
 * @param {World} world
 * @param {function} query
 */
export const resetChangedQuery = (world, query) => {
  const q = world[$queryMap].get(query)
  q.changed = []
}

/**
 * Removes a query from a world.
 *
 * @param {World} world
 * @param {function} query
 */
export const removeQuery = (world, query) => {
  const q = world[$queryMap].get(query)
  world[$queries].delete(q)
  world[$queryMap].delete(query)
}