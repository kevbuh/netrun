import gymnasium as gym
import ale_py

# NOTE: do not use from gymnasium.wrappers import AtariPreprocessing, FrameStack
# instead, use import ale_py and use env = gym.wrappers.FrameStackObservation(env, 4)

gym.register_envs(ale_py)
env = gym.make(
    "ALE/MsPacman-v5",
    frameskip=4,
    # render_mode="human"
)
print("Observation Space:", env.observation_space)
print("Action Space:", env.action_space)
print("Possible actions:", env.unwrapped.get_action_meanings())

obs, info = env.reset(seed=42)
total_reward = 0
NUM_STEPS = 40_000_000

for _ in range(NUM_STEPS):
    action = env.action_space.sample()

    obs, reward, terminated, truncated, info = env.step(action)
    # print(f"action={action}, reward={reward}")
    total_reward += reward

    if terminated or truncated:
        print(f"Episode finished with total reward: {total_reward}")
        obs, info = env.reset()
        total_reward = 0

env.close()
