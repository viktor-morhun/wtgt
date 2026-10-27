import { useEffect } from 'react';
import { Home } from './components/Home';
import { Room } from './components/Room';
import { useRoute } from './route';

export function App() {
  const route = useRoute();

  useEffect(() => {
    if (route.kind === 'home') document.title = 'Смотрим вместе';
  }, [route.kind]);

  // key — другая комната начинается с чистого состояния (вход, плеер, соединение)
  return route.kind === 'room' ? <Room key={route.code} code={route.code} /> : <Home />;
}
