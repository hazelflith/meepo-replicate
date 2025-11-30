pipeline {
  agent any

  environment {
    IMAGE_NAME = "meepo-replicate"
    DOCKERHUB_NAMESPACE = "quantumteknologi"
    GIT_REPO = "meepo-replicate"
    GIT_BRANCH = "main"
    GIT_CREDENTIAL = "meepo-autobot"
    ENV_FILE_CREDENTIAL = "meepo-replicate-key"
    REGISTRY_CREDENTIAL = "dockerhub-qtn"
    KUBECONFIG_CREDENTIAL = "kubeconfig-rafli"
    K8S_NAMESPACE = "meepo-replicate"
    DEPLOYMENT_NAME = "meepo-replicate"
  }

  options {
    skipDefaultCheckout(true)
  }

  stages {

    stage('Checkout') {
      steps {
        git branch: "${GIT_BRANCH}", credentialsId: "${GIT_CREDENTIAL}", url: "https://github.com/QTN-DEV/${GIT_REPO}.git"
      }
    }

    stage('Set Commit Hash as Tag') {
      steps {
        script {
          env.IMAGE_TAG = sh(
            script: "git rev-parse --short HEAD",
            returnStdout: true
          ).trim()
          echo "Using IMAGE_TAG = ${env.IMAGE_TAG}"
        }
      }
    }

    stage('Prepare .env (optional)') {
      steps {
        withCredentials([file(credentialsId: "${ENV_FILE_CREDENTIAL}", variable: 'ENV_FILE')]) {
          sh 'if [ -f "${ENV_FILE}" ]; then cp "${ENV_FILE}" .env; fi'
        }
      }
    }

    stage('Build Docker Image') {
      steps {
        sh """
          docker build -f Dockerfile \
          -t ${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG} .
        """
      }
    }

    stage('Push Docker Image') {
      steps {
        withCredentials([usernamePassword(credentialsId: "${REGISTRY_CREDENTIAL}", usernameVariable: 'DH_USER', passwordVariable: 'DH_PWD')]) {
          sh '''
            echo "$DH_PWD" | docker login --username "$DH_USER" --password-stdin
            docker push ${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG}
            docker logout || true
          '''
        }
      }
    }

    stage('Update Deployment via kubectl') {
      steps {
        withCredentials([file(credentialsId: "${KUBECONFIG_CREDENTIAL}", variable: 'KUBECONFIG_FILE')]) {

          sh '''
            export KUBECONFIG=${KUBECONFIG_FILE}

            echo "Updating image using kubectl..."
            kubectl set image deployment/${DEPLOYMENT_NAME} \
              ${DEPLOYMENT_NAME}=${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG} \
              -n ${K8S_NAMESPACE} --record

            echo "Restarting deployment to force rollout..."
            kubectl rollout restart deployment/${DEPLOYMENT_NAME} -n ${K8S_NAMESPACE}

            echo "Waiting for rollout..."
            kubectl rollout status deployment/${DEPLOYMENT_NAME} -n ${K8S_NAMESPACE}
          '''
        }
      }
    }

    stage('Cleanup Local Docker Images') {
      steps {
        sh """
          docker rmi ${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG} || true
          docker image prune -f || true
        """
      }
    }
  }

  post {
    always {
      sh 'rm -f .env || true'
    }
  }
}
