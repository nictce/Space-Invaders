import { fromEvent, interval, merge } from 'rxjs'
import { map, filter, scan, tap } from 'rxjs/operators'

type Key = 'ArrowLeft' | 'ArrowRight' | 'Space' | 'KeyR'
type Event = 'keydown' | 'keyup'

function spaceinvaders() {
  // Inside this function you will use the classes and functions 
  // from rx.js
  // to add visuals to the svg element in pong.html, animate them, and make them interactive.
  // Study and complete the tasks in observable exampels first to get ideas.
  // Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/ 
  // You will be marked on your functional programming style
  // as well as the functionality that you implement.
  // Document your code!  

  const Constants = {
    CanvasSize: 600,
    StartTime: 0,
    ShipVelocity: 5,

    BulletExpirationTime: 1000,
    BulletRadius: 3,
    BulletVelocity: -10,

    ProjectileRadius: 3, 
    ProjectileVelocity: -5,

    StartShieldRadius: 30,
    StartShieldsCount: 5,
    ShieldReduction: 3/4,
    ShieldTolerance: 4,
    HoleRadius: 4,

    StartAlienRadius: 10,
    StartAliensCount: 28,
    AlienVelocity: 0.8,
    AlienFireRate: 0.001
  } as const

  type ViewType = 'ship' | 'shield' | 'bullet' | 'alien' | 'projectile' | 'hole'
  type Circle = Readonly<{x:number, y:number, radius:number}>
  type ObjectId = Readonly<{id:string,createTime:number}>
  type Body = Readonly<IBody> // Every object that participates in physics is a Body
  type State = Readonly<{
    time:number,
    rng: RNG,
    ship:Body,
    bullets:ReadonlyArray<Body>,
    aliens:ReadonlyArray<Body>,
    projectiles:ReadonlyArray<Body>,
    shields:ReadonlyArray<Body>,
    holes: ReadonlyArray<Body>,
    exit:ReadonlyArray<Body>,
    objCount:number,
    speedMultiplier:number,
    score: number,
    level: number,
    gameOver:boolean
  }>
    
  class Tick { constructor(public readonly elapsed:number) {} }
  class Move { constructor(public readonly direction: string) {}}
  class Shoot { constructor() {} }
  class Restart { constructor() {} }

  interface IBody extends Circle, ObjectId {
    viewType: ViewType,
    left: boolean,
    right: boolean,
    velX: number,
    velY: number
  }
  
  const keyObservable = <T>(e:Event, k:Key, result:()=>T)=>
    fromEvent<KeyboardEvent>(document,e)
      .pipe(
        filter(({code})=>code === k),
        filter(({repeat})=>!repeat),
       map(result))
  
  // Separate Observable streams controlling the game
  const
    gameClock = interval(10).pipe(map(elapsed => new Tick(elapsed))),
    startLeftMove = keyObservable('keydown','ArrowLeft',()=>new Move('startLeft')),
    startRightMove = keyObservable('keydown','ArrowRight',()=>new Move('startRight')),
    stopLeftMove = keyObservable('keyup','ArrowLeft',()=>new Move('stopLeft')),
    stopRightMove = keyObservable('keyup','ArrowRight',()=>new Move('stopRight')),
    shoot = keyObservable('keydown','Space', ()=>new Shoot()),
    restart = keyObservable('keydown','KeyR',()=>new Restart())

  // Creating the elements of the game
  const 
    createShip = ():Body => ({
      id: 'ship',
      viewType: 'ship',
      x: 300,
      y: 550,
      velX: 0,
      velY: 0,
      left: false,
      right: false,
      radius:20,
      createTime:0
    }),
    createCircle = (viewType: ViewType) => (velX:number, velY: number) => (circ:Circle) => (oid:ObjectId) => <Body>{
      viewType: viewType,
      ...oid,
      id: viewType+oid.id,
      ...circ,      
      velX: velX,
      velY: velY,
    },
    createBullet = createCircle('bullet')(0, Constants.BulletVelocity),
    createAlien = createCircle('alien')(Constants.AlienVelocity, 0),
    createShield = createCircle('shield')(0, 0),
    createProjectile = createCircle('projectile')(0, -Constants.ProjectileVelocity),
    createHole = createCircle('hole')(0, 0)
    

  // Initialising the game
  const startAliens = (objCount:number) => [...Array(Constants.StartAliensCount)]
    .map((_, i) => 
      createAlien({x: i%7*40+160, y: Math.floor(i/7)*40+60, radius: Constants.StartAlienRadius})
      ({id: String(objCount + i), createTime: Constants.StartTime}))
  const startShields = (objCount:number) => [...Array(Constants.StartShieldsCount)]
    .map((_, i) => 
      createShield({x: (i+1)*100, y: 480, radius: Constants.StartShieldRadius})
      ({id: String(objCount + i), createTime: Constants.StartTime}))
  const initialState = ():State => ({
    time:0,
    rng: new RNG(1),
    ship: createShip(),
    bullets: [],
    aliens: startAliens(0),
    projectiles: [],
    shields: startShields(Constants.StartAliensCount),
    holes: [],
    exit: [],
    objCount: Constants.StartAliensCount + Constants.StartShieldsCount,
    speedMultiplier: 1,
    score: 0,
    level: 1,
    gameOver: false
  })

  // Defining the movement of game elements
  const moveBody = (o:Body) => <Body>{
    ...o,
    x: o.x+o.velX > 575 ? 575 : o.x+o.velX < 25 ? 25 : o.x+o.velX,
    y: o.y+o.velY
  }
  const moveAliens = (aliens:ReadonlyArray<IBody>) => (speedMultiplier:number): ReadonlyArray<IBody> => {
    const vel = aliens.length > 0 ? aliens[0].velX * speedMultiplier : 0
    const extreme = vel > 0
      ? aliens.reduce((a, v) => a > v.x ? a : v.x, 25)
      : aliens.reduce((a, v) => a < v.x ? a : v.x, 575)
    return extreme<=25 || extreme>=575
      ? aliens.map(a => ({...a, x: a.x - vel, y: a.y + 20, velX: -a.velX}))
      : aliens.map(a => ({...a, x: a.x + vel}))
  }

  // Handling collisions
  const handleCollisions = (s:State) => {
    const
      distance = ([a,b]:[Body,Body]) => Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2),
      bodiesCollided = ([a,b]:[Body,Body]) => distance([a,b]) < a.radius + b.radius,
      cut = except((a:Body)=>(b:Body)=>a.id === b.id),

      // Collisions between the Ship and Projectiles and/or Aliens
      shipCollided = s.projectiles.filter(a=>bodiesCollided([s.ship,a])).length > 0 
        || s.aliens.filter(a=>bodiesCollided([s.ship,a])).length > 0,

      // Bullets and Aliens
      allBulletsAndAliens = flatMap(s.bullets, b=> s.aliens.map<[Body,Body]>(a=>([b,a]))),
      collidedBulletsAndAliens = allBulletsAndAliens.filter(bodiesCollided),

      // Projectiles and Shields
      allProjectilesAndShields = flatMap(s.projectiles, p=> s.shields.map<[Body,Body]>(s=>([p,s]))),
      collidedProjectilesAndShields = allProjectilesAndShields.filter(bodiesCollided),
      collidedProjectiles = collidedProjectilesAndShields.map(([projectile,_])=>projectile),

      // Aliens and Shields
      allAliensAndShields = flatMap(s.aliens, p=> s.shields.map<[Body,Body]>(s=>([p,s]))),
      collidedAliensAndShields = allAliensAndShields.filter(bodiesCollided),
      collidedAliens = collidedAliensAndShields.map(([projectile,_])=>projectile)
        .concat(collidedBulletsAndAliens.map(([_,alien])=>alien)),

      // Bullets and Shields
      allBulletsAndShields = flatMap(s.bullets, p=> s.shields.map<[Body,Body]>(s=>([p,s]))),
      collidedBulletsAndShields = allBulletsAndShields.filter(bodiesCollided),
      collidedShields = collidedProjectilesAndShields.map(([_,shield])=>shield)
        .concat(collidedBulletsAndShields.map(([_,shield])=>shield))
        .concat(collidedAliensAndShields.map(([_,shield])=>shield)),

      // Bullets and Projectiles
      allBulletsAndProjectiles = flatMap(s.bullets, b=> s.projectiles.map<[Body,Body]>(r=>([b,r]))),
      collidedBulletsAndProjectiles = allBulletsAndProjectiles.filter(bodiesCollided),
      collidedBullets = collidedBulletsAndAliens.map(([bullet,_])=>bullet)
        .concat(collidedBulletsAndProjectiles.map(([bullet,_])=>bullet))
        .concat(collidedBulletsAndShields.map(([projectile,_])=>projectile)),

      // No need for collidedProjectiles as they are not affected by bullets

      // blockedBullets = collidedBulletsAndShields.map(([bullet,_])=>bullet),//.concat(collidedProjectiles),
      //   // v => s.holes.map<[Body,Body]>(h=>([v,h])))
      // bulletsinHoles = blockedBullets.filter((v) => s.holes.forEach(h => (distance([v,h]) + v.radius) <= h.radius)),
      // newHoles = cut(blockedBullets)(bulletsinHoles)//.filter((v) => s.holes.forEach(h => (distance([v,h]) + v.radius) > h.radius))
      //   .reduce((t,v) => ({
      //     holes: t.holes.concat(createHole({
      //       x: v.x, y: v.y, radius: Constants.HoleRadius})
      //         ({id: String(t.objCount), createTime: s.time})), 
      //       objCount: t.objCount+1}),
      //     {holes: [], objCount: s.objCount})
        // .forEach(v => createHole({x: v.x, y: v.x, radius: Constants.HoleRadius})({id: , createTime: s.time}))
      reduceShield = (s:Body) => ({x: s.x, y: s.y, radius: s.radius*Constants.ShieldReduction}),
      reducedShields = collidedShields.map(reduceShield)
        .filter(v => v.radius >= Constants.StartShieldRadius * Constants.ShieldReduction ** Constants.ShieldTolerance)
        .map((v,i) => createShield(v)({id: String(s.objCount+i), createTime: s.time}))
      
      const remainingAliens = cut(s.aliens)(collidedAliens),
      aliensDestroyed = remainingAliens.length == 0
  //  console.log(flatMap(collidedBulletsAndShields.map(([bullet,_])=>bullet).concat(collidedProjectiles),
  //  v => s.holes.map<[Body,Body]>(h=>([v,h]))))
    return <State>{
      ...s,
      bullets: cut(s.bullets)(collidedBullets),
      aliens: aliensDestroyed ? startAliens(s.objCount/*+reducedShields.length*/) : cut(s.aliens)(collidedAliens),
      projectiles: cut(s.projectiles)(collidedProjectiles),
      shields: cut(s.shields)(collidedShields).concat(reducedShields),
      // holes: s.holes.concat(newHoles.holes),
      exit: s.exit.concat(collidedBullets,collidedAliens,collidedProjectiles,collidedShields),
      objCount: s.objCount+ reducedShields.length,
      speedMultiplier: Math.sqrt((28 - remainingAliens.length))/4 + Math.sqrt(s.level),
      score: s.score + collidedAliens.length,
      level: s.level + +aliensDestroyed,
      gameOver: s.gameOver || shipCollided
    }
  }

  // Determining time-based actions
  const tick = (s:State, elapsed:number) => {
    const 
      expired = (b:Body)=>(elapsed - b.createTime) > 100,
      expiredBullets:Body[] = s.bullets.filter(expired),
      activeBullets = s.bullets.filter(not(expired)),
      
      newProjectiles = s.aliens.reduce(
        (t, v) => ({
            rng: t.rng.next(), 
            projectiles: t.projectiles.concat(
              t.rng.nextFloat() < Constants.AlienFireRate 
              ? createProjectile({x: v.x, y: v.y, radius: Constants.ProjectileRadius})
                ({id: String(t.objCount), createTime: s.time})
              : []
              ),
            objCount: t.objCount + +(t.rng.nextFloat() < Constants.AlienFireRate)
          })
          , {rng: s.rng, projectiles: [], objCount: s.objCount}
      ),
      
      expiredProjectiles:Body[] = s.projectiles.filter(expired),
      activeProjectiles = s.projectiles.filter(not(expired)),

      movedAliens = moveAliens(s.aliens)(s.speedMultiplier)

    return handleCollisions(
      s.gameOver 
        ? s 
        : {...s, 
          rng: newProjectiles.rng,
          ship: moveBody(s.ship), 
          bullets: activeBullets.map(moveBody), 
          aliens: movedAliens, 
          projectiles: activeProjectiles.concat(newProjectiles.projectiles).map(moveBody),//newProjectile ? activeProjectiles.concat(newProjectile).map(moveBody) : activeProjectiles.map(moveBody),
          exit: expiredBullets.concat(expiredProjectiles),
          objCount: newProjectiles.objCount,//s.objCount + (aggAlien ? 1 : 0),
          time: elapsed,
          gameOver: movedAliens.reduce((t,v) => t || (v.y >= 480), false)
        }
    )
  }

  const calculateShipVel = (s:Body) => (m:Move) => (v:number) =>
    s.left && s.right 
      ? m.direction=='stopLeft' ? v 
      : m.direction == 'stopRight' ? -v 
      : 0
    : s.left && m.direction == 'startRight' || s.right && m.direction == 'startLeft' ? 0
    : m.direction == 'startRight' ? v 
    : m.direction == 'startLeft' ? -v
    : m.direction == 'stopRight' ? 0 
    : m.direction == 'stopLeft' ? 0 
    : s.velX
      
  // The State Transducer that processes user interaction
  const reduceState = (s:State, e:Tick|Move|Shoot|Restart) =>
    e instanceof Move 
    ? {...s, ship: {...s.ship, 
      left: e.direction == 'startLeft' ? true : e.direction == 'stopLeft' ? false : s.ship.left,
      right: e.direction == 'startRight' ? true : e.direction == 'stopRight' ? false : s.ship.right,
      velX: calculateShipVel(s.ship)(e)(Constants.ShipVelocity + Math.sqrt(s.level * 5)),
      x: s.gameOver ? s.ship.x : s.ship.x+s.ship.velX}} 
    : e instanceof Shoot 
    ? {...s, 
      bullets: s.bullets.concat([
        createBullet({x: s.ship.x,y: s.ship.y,radius: Constants.BulletRadius})
                    ({id: String(s.objCount), createTime: s.time})
        ]), objCount: s.objCount + 1}
    : e instanceof Restart
    ? {...initialState(), exit: s.bullets.concat(s.projectiles).concat(s.shields).concat(s.aliens)}
    : tick(s, e.elapsed)

  // The main stream where views can be updated from according to user interaction
  const subscription = 
    merge(gameClock, startLeftMove, startRightMove, stopLeftMove, stopRightMove, shoot, restart)
    .pipe(scan(reduceState, initialState()))
    .subscribe(updateView)
    
  // Updating the views in the page
  function updateView(s: State) {
    const svg = document.getElementById("canvas")!

    const 
      createShipSvg = (): Element => {
        const 
          g = document.createElementNS(svg.namespaceURI, "g"),
          ship = document.createElementNS(svg.namespaceURI, "polygon")
        attr(g, {id:"ship", transform:"translate(300,550)"})
        attr(ship, {class:"ship", points:"-15,20 15,20 0,-20"})
        g.appendChild(ship)
        svg.appendChild(g)
        return g
      },
      updateBodyView = (b:Body) => {
        function createCircleView() {
          const v = document.createElementNS(svg.namespaceURI, "ellipse")
          attr(v,{id: b.id, rx: b.radius, ry: b.radius})
          v.classList.add(b.viewType)
          svg.appendChild(v)
          return v
        }
        const v = document.getElementById(b.id) || createCircleView()
        attr(v, {'cx': b.x, 'cy': b.y})
      }

    const 
      ship = document.getElementById("ship")!,
      score = document.getElementById("score")!,
      level = document.getElementById("level")!,
      gameover = document.getElementById("gameover")!,
      gameoverSt = document.getElementById("gameoverSubtext")!

    attr(ship, {'transform': `translate(${s.ship.x},${s.ship.y})`})
    level.textContent = `Level: ${s.level}`
    score.textContent = `Score: ${String(s.score).padStart(3, '0')}`
    s.bullets.forEach(updateBodyView)
    s.aliens.forEach(updateBodyView)
    s.projectiles.forEach(updateBodyView)
    s.shields.forEach(updateBodyView)
    s.holes.forEach(updateBodyView)
    s.exit.map(o=>document.getElementById(o.id))
      .filter(isNotNullOrUndefined)
      .forEach(v=>{
        try {
          svg.removeChild(v)
        } catch(e) {
          // rarely it can happen that a bullet can be in exit 
          // for both expiring and colliding in the same tick,
          // which will cause this exception
          console.log("Already removed: "+v.id)
        }
      })
    s.gameOver ? gameover.textContent = "Game Over!" : gameover.textContent = ""
    s.gameOver ? gameoverSt.textContent = "-Press 'R' to restart-" : gameoverSt.textContent = ""
  }

  
  
}
  
// Running Space Invaders on window onload
if (typeof window != 'undefined') window.onload = spaceinvaders
  
  
// Helper functions and classes
class RNG {
  /**
   * LCG using GCC's constants. Everything here is private to hide implementation details outside
   * the class. They are readonly to prevent mutation.
   */
  private static readonly m = 0x80000000 // 2**31
  private static readonly a = 1103515245
  private static readonly c = 12345

  /**
   * Constructor for the RNG.
   * 
   * @param seed the seed for our RNG. This is made readonly to prevent mutation.
   */
  constructor(private readonly seed: number = 0) { }

  /**
   * Generates the next random integer along with a new RNG with a different seed. This approach
   * avoids the need of having a mutable state for our RNG. This method is made private as there is
   * no need to call this method outside the class.
   *
   * @returns an object with an integer value and the next RNG object.
   */
  private readonly nextInt = () => {
    const val = (RNG.a * this.seed + RNG.c) % RNG.m
    // const next = new RNG(val); // we're returning a new RNG object for the next call
    return val // no mutation done here
  }

  /**
   * Generates the next random floating number in the range [0..1]. Very much like nextInt, it
   * returns a single number along with a new RNG as there is no way to mutate the state of this RNG
   * object. This method is declared readonly to prevent the method from being redefined outside the
   * class.
   *
   * @returns an object with an integer value and the next RNG object.
   */
  readonly nextFloat = () => {
    // returns in range [0,1]
    return this.nextInt() / (RNG.m - 1)
    // const val = this.nextInt()
    // return {
    //   val: val / (RNG.m - 1), // convert the integer into a float
    //   next: new RNG(val)
    // };
  }

  readonly next = () => new RNG(this.nextInt())
}

const 
  /**
   * Composable not: invert boolean result of given function
   * @param f a function returning boolean
   * @param x the value that will be tested with f
   */
  not = <T>(f:(x:T)=>boolean)=> (x:T)=> !f(x),  
  /**
   * is e an element of a using the eq function to test equality?
   * @param eq equality test function for two Ts
   * @param a an array that will be searched
   * @param e an element to search a for
   */
  elem = <T>(eq: (_:T)=>(_:T)=>boolean)=> 
    (a:ReadonlyArray<T>)=> 
      (e:T)=> a.findIndex(eq(e)) >= 0,
  /**
   * array a except anything in b
   * @param eq equality test function for two Ts
   * @param a array to be filtered
   * @param b array of elements to be filtered out of a
   */ 
  except = <T>(eq: (_:T)=>(_:T)=>boolean) =>
    (a:ReadonlyArray<T>)=> 
      (b:ReadonlyArray<T>)=> a.filter(not(elem(eq)(b))),
  /**
   * set a number of attributes on an Element at once
   * @param e the Element
   * @param o a property bag
   */         
  attr = (e:Element, o:{[key:string]: string|number}) =>
    Object.keys(o).forEach(key => e.setAttribute(key, String(o[key])))
  
  // remove = (svg:HTMLElement) => (type:string) => {
  //   for(const x in svg.getElementsByClassName(type).length) {
  //     svg.removeChild(x.)
  //   }
  // }

function flatMap<T,U>(a:ReadonlyArray<T>, f:(a:T)=>ReadonlyArray<U>): ReadonlyArray<U> {
  return Array.prototype.concat(...a.map(f))
}
function isNotNullOrUndefined<T extends Object>(input: null | undefined | T): input is T {
  return input != null
}