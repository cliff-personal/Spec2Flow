import { useNavigate } from 'react-router-dom';

export function ControlPlaneHomePage(): JSX.Element {
  const navigate = useNavigate();

  return (
    <div className="s2f-home-page">
      <div className="s2f-home-center">
        <div className="s2f-brand-large">
          <span>{'>'}</span> SPEC2FLOW
        </div>
        
        <div className="s2f-prompt-line">
          The calm before the storm...
          <span className="s2f-prompt-cursor"></span>
        </div>

        <button 
          className="s2f-enter-button" 
          onClick={() => navigate('/projects')}
        >
          Initialize System
        </button>
      </div>
    </div>
  );
}